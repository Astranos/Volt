import Foundation
@preconcurrency import WebRTC

@MainActor
final class ScannerWebRTCConnection: NSObject {
    var onStatusChange: ((ScannerConnectionStatus) -> Void)?
    var onSessionReady: ((ScannerProtocol.SessionReady) -> Void)?
    var onResultReceived: ((ScannerProtocol.ResultReceived) -> Void)?

    private let contributorId: String
    private let signaling = ScannerSignalingClient()
    private let factory = RTCPeerConnectionFactory()
    private var peerConnection: RTCPeerConnection?
    private var controlChannel: RTCDataChannel?
    private var photoChannel: RTCDataChannel?
    private var iceGatheringContinuation: CheckedContinuation<Void, Never>?
    private var pendingPhotoReceipts: [String: CheckedContinuation<ScannerProtocol.PhotoDeliveryReceipt, Error>] = [:]
    private var pendingPhotoReceiptTimeouts: [String: Task<Void, Never>] = [:]
    private var completedPhotoReceipts: [String: ScannerProtocol.PhotoDeliveryReceipt] = [:]
    private var latestPhotoChunkAcks: [String: ScannerProtocol.PhotoChunkAck] = [:]

    init(contributorId: String) {
        self.contributorId = contributorId
        RTCInitializeSSL()
        super.init()
    }

    deinit {
        RTCCleanupSSL()
    }

    var isConnected: Bool {
        controlChannel?.readyState == .open
    }

    func pair(with session: PairingSession) async throws {
        onStatusChange?(.pairing)
        let resolved = try await resolvePairing(session)
        let answer = try await createAnswer(for: resolved.offer)
        try await signaling.postAnswer(answer, to: resolved.answerURL)
        onStatusChange?(.waitingForChrome)
    }

    func close() {
        failPendingPhotoReceipts(with: ScannerPairingError.channelNotOpen)
        controlChannel?.close()
        photoChannel?.close()
        peerConnection?.close()
        controlChannel = nil
        photoChannel = nil
        peerConnection = nil
        onStatusChange?(.disconnected)
    }

    func sendControl(_ message: [String: Any]) throws {
        guard let controlChannel, controlChannel.readyState == .open else {
            throw ScannerPairingError.channelNotOpen
        }
        let rawValue = try ScannerProtocol.encodedControlMessage(message)
        let data = Data(rawValue.utf8)
        controlChannel.sendData(RTCDataBuffer(data: data, isBinary: false))
    }

    func sendPhoto(_ payload: ScannerProtocol.PhotoPayload) async throws {
        guard let photoChannel, photoChannel.readyState == .open else {
            throw ScannerPairingError.channelNotOpen
        }

        let base64 = payload.data.base64EncodedString()
        let chunks = base64.chunked(maxLength: ScannerProtocol.chunkSize)
        try sendPhotoMessage(ScannerProtocol.photoStart(payload, contributorId: contributorId, totalChunks: chunks.count), through: photoChannel)
        for (index, chunk) in chunks.enumerated() {
            try sendPhotoMessage(
                ScannerProtocol.photoChunk(photoId: payload.id, index: index, totalChunks: chunks.count, data: chunk),
                through: photoChannel
            )
            await Task.yield()
        }
        let receiptTask = Task { @MainActor in
            try await waitForPhotoReceipt(photoId: payload.id)
        }
        do {
            try sendPhotoMessage(ScannerProtocol.photoComplete(photoId: payload.id, totalChunks: chunks.count), through: photoChannel)
        } catch {
            receiptTask.cancel()
            throw error
        }
        let receipt = try await receiptTask.value
        if case .rejected(let rejection) = receipt {
            throw ScannerPairingError.photoRejected(rejection.detail ?? rejection.reason)
        }
    }

    private func resolvePairing(_ session: PairingSession) async throws -> (offer: String, answerURL: URL, sessionId: String?) {
        if let offer = session.offer, let answerURL = session.answerURL {
            return (offer, answerURL, session.sessionId)
        }

        guard let token = session.token else {
            throw ScannerPairingError.missingPairingURL
        }
        let attempt = try await signaling.createJoinAttempt(token: token, contributorId: contributorId)
        return try await signaling.pollOffer(token: token, attempt: attempt)
    }

    private func createAnswer(for encodedOffer: String) async throws -> ScannerProtocol.SessionDescription {
        let offer = try ScannerProtocol.decodePairingPayload(encodedOffer)
        guard offer.type == "offer" else {
            throw ScannerPairingError.invalidPairingPayload
        }

        let configuration = RTCConfiguration()
        configuration.iceServers = [
            RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"]),
            RTCIceServer(urlStrings: ["stun:stun1.l.google.com:19302"]),
        ]
        configuration.iceTransportPolicy = .all
        configuration.sdpSemantics = .unifiedPlan

        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let peerConnection = factory.peerConnection(with: configuration, constraints: constraints, delegate: self) else {
            throw ScannerPairingError.couldNotCreatePeer
        }
        self.peerConnection = peerConnection

        try await setRemoteDescription(RTCSessionDescription(type: .offer, sdp: offer.sdp), on: peerConnection)
        let answer = try await answer(on: peerConnection, constraints: constraints)
        try await setLocalDescription(answer, on: peerConnection)
        await waitForIceGathering()

        guard let localDescription = peerConnection.localDescription else {
            throw ScannerPairingError.missingAnswer
        }
        return ScannerProtocol.SessionDescription(type: RTCSessionDescription.string(for: localDescription.type), sdp: localDescription.sdp)
    }

    private func answer(on peerConnection: RTCPeerConnection, constraints: RTCMediaConstraints) async throws -> RTCSessionDescription {
        try await withCheckedThrowingContinuation { continuation in
            peerConnection.answer(for: constraints) { description, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let description {
                    continuation.resume(returning: description)
                } else {
                    continuation.resume(throwing: ScannerPairingError.missingAnswer)
                }
            }
        }
    }

    private func setRemoteDescription(_ description: RTCSessionDescription, on peerConnection: RTCPeerConnection) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peerConnection.setRemoteDescription(description) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    private func setLocalDescription(_ description: RTCSessionDescription, on peerConnection: RTCPeerConnection) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peerConnection.setLocalDescription(description) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    private func waitForIceGathering() async {
        if peerConnection?.iceGatheringState == .complete { return }
        await withCheckedContinuation { continuation in
            iceGatheringContinuation = continuation
            Task { @MainActor in
                try? await Task.sleep(for: ScannerProtocol.iceGatheringTimeout)
                iceGatheringContinuation?.resume()
                iceGatheringContinuation = nil
            }
        }
    }

    private func sendPhotoMessage(_ message: [String: Any], through channel: RTCDataChannel) throws {
        let rawValue = try ScannerProtocol.encodedControlMessage(message)
        channel.sendData(RTCDataBuffer(data: Data(rawValue.utf8), isBinary: false))
    }

    private func configure(_ channel: RTCDataChannel) {
        channel.delegate = self
        if channel.label == ScannerProtocol.controlChannelLabel {
            controlChannel = channel
        } else if channel.label == ScannerProtocol.photoTransferChannelLabel {
            photoChannel = channel
        }
    }

    private func handleControlMessage(_ rawValue: String) {
        if let sessionReady = ScannerProtocol.parseSessionReady(rawValue) {
            onSessionReady?(sessionReady)
            return
        }
        if let resultReceived = ScannerProtocol.parseResultReceived(rawValue) {
            onResultReceived?(resultReceived)
            return
        }
        if let chunkAck = ScannerProtocol.parsePhotoChunkAck(rawValue) {
            latestPhotoChunkAcks[chunkAck.photoId] = chunkAck
            return
        }
        if let photoReceived = ScannerProtocol.parsePhotoReceived(rawValue) {
            resumePhotoReceipt(.received(photoReceived), photoId: photoReceived.photoId)
            return
        }
        if let photoRejected = ScannerProtocol.parsePhotoRejected(rawValue) {
            resumePhotoReceipt(.rejected(photoRejected), photoId: photoRejected.photoId)
        }
    }

    private func waitForPhotoReceipt(photoId: String) async throws -> ScannerProtocol.PhotoDeliveryReceipt {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if let receipt = completedPhotoReceipts.removeValue(forKey: photoId) {
                    continuation.resume(returning: receipt)
                    return
                }
                if let existingContinuation = pendingPhotoReceipts.removeValue(forKey: photoId) {
                    existingContinuation.resume(throwing: ScannerPairingError.photoDeliveryInterrupted)
                }
                pendingPhotoReceiptTimeouts[photoId]?.cancel()
                pendingPhotoReceipts[photoId] = continuation
                pendingPhotoReceiptTimeouts[photoId] = Task { @MainActor in
                    try? await Task.sleep(for: ScannerProtocol.photoReceiptTimeout)
                    guard !Task.isCancelled else { return }
                    timeoutPendingPhotoReceipt(photoId: photoId)
                }
            }
        } onCancel: {
            Task { @MainActor in
                cancelPendingPhotoReceipt(photoId: photoId)
            }
        }
    }

    private func resumePhotoReceipt(_ receipt: ScannerProtocol.PhotoDeliveryReceipt, photoId: String) {
        latestPhotoChunkAcks[photoId] = nil
        pendingPhotoReceiptTimeouts.removeValue(forKey: photoId)?.cancel()
        if let continuation = pendingPhotoReceipts.removeValue(forKey: photoId) {
            continuation.resume(returning: receipt)
        } else {
            completedPhotoReceipts[photoId] = receipt
        }
    }

    private func cancelPendingPhotoReceipt(photoId: String) {
        latestPhotoChunkAcks[photoId] = nil
        completedPhotoReceipts[photoId] = nil
        pendingPhotoReceiptTimeouts.removeValue(forKey: photoId)?.cancel()
        pendingPhotoReceipts.removeValue(forKey: photoId)?.resume(throwing: ScannerPairingError.photoDeliveryInterrupted)
    }

    private func timeoutPendingPhotoReceipt(photoId: String) {
        latestPhotoChunkAcks[photoId] = nil
        completedPhotoReceipts[photoId] = nil
        pendingPhotoReceiptTimeouts[photoId] = nil
        pendingPhotoReceipts.removeValue(forKey: photoId)?.resume(throwing: ScannerPairingError.photoDeliveryTimedOut)
    }

    private func failPendingPhotoReceipts(with error: Error) {
        let continuations = pendingPhotoReceipts.values
        pendingPhotoReceipts.removeAll()
        completedPhotoReceipts.removeAll()
        latestPhotoChunkAcks.removeAll()
        pendingPhotoReceiptTimeouts.values.forEach { $0.cancel() }
        pendingPhotoReceiptTimeouts.removeAll()
        for continuation in continuations {
            continuation.resume(throwing: error)
        }
    }
}

extension ScannerWebRTCConnection: RTCPeerConnectionDelegate {
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}

    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        Task { @MainActor in
            switch newState {
            case .connected:
                break
            case .disconnected, .failed, .closed:
                failPendingPhotoReceipts(with: ScannerPairingError.channelNotOpen)
                onStatusChange?(.disconnected)
            default:
                break
            }
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        guard newState == .complete else { return }
        Task { @MainActor in
            iceGatheringContinuation?.resume()
            iceGatheringContinuation = nil
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        Task { @MainActor in
            configure(dataChannel)
            if dataChannel.readyState == .open, dataChannel.label == ScannerProtocol.controlChannelLabel {
                try? sendControl(ScannerProtocol.helloMessage(contributorId: contributorId))
            }
        }
    }
}

extension ScannerWebRTCConnection: RTCDataChannelDelegate {
    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        Task { @MainActor in
            configure(dataChannel)
            if dataChannel.readyState == .open, dataChannel.label == ScannerProtocol.controlChannelLabel {
                try? sendControl(ScannerProtocol.helloMessage(contributorId: contributorId))
            }
        }
    }

    nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        guard !buffer.isBinary, let rawValue = String(data: buffer.data, encoding: .utf8) else { return }
        Task { @MainActor in
            if dataChannel.label == ScannerProtocol.controlChannelLabel {
                handleControlMessage(rawValue)
            }
        }
    }
}

private extension String {
    func chunked(maxLength: Int) -> [String] {
        guard count > maxLength else { return [self] }
        var chunks: [String] = []
        var start = startIndex
        while start < endIndex {
            let end = index(start, offsetBy: maxLength, limitedBy: endIndex) ?? endIndex
            chunks.append(String(self[start..<end]))
            start = end
        }
        return chunks
    }
}
