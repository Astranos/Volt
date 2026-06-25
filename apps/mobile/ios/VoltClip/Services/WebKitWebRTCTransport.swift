import Foundation
import UIKit
@preconcurrency import WebKit

@MainActor
final class WebKitWebRTCTransport: NSObject {
    var onStatus: ((String) -> Void)?
    var onConnected: ((ScannerProtocol.SessionReady) -> Void)?
    var onTranscript: ((String, Bool) -> Void)?
    var onClosed: (() -> Void)?
    var onError: ((String) -> Void)?

    private let signaling = ScannerSignalingClient()
    private var webView: WKWebView?
    private var loadContinuation: CheckedContinuation<Void, Error>?
    private var answerContinuation: CheckedContinuation<ScannerProtocol.SessionDescription, Error>?
    private var resultContinuations: [String: CheckedContinuation<ScannerProtocol.ResultReceived, Error>] = [:]
    private var resultTimeoutTasks: [String: Task<Void, Never>] = [:]
    private var photoContinuations: [String: CheckedContinuation<ScannerProtocol.PhotoReceived, Error>] = [:]
    private var photoTimeoutTasks: [String: Task<Void, Never>] = [:]
    private var isLoaded = false

    var embeddedWebView: WKWebView {
        if let webView {
            return webView
        }
        let next = makeWebView()
        webView = next
        return next
    }

    func pair(with session: PairingSession, contributorId: String) async throws {
        let resolved = try await resolvePairing(session, contributorId: contributorId)
        let offer = try ScannerProtocol.decodePairingPayload(resolved.offer)
        let iceConfiguration = (try? await signaling.fetchIceServerConfiguration(
            signalURL: resolved.signalURL
        )) ?? ScannerProtocol.fallbackIceServerConfiguration
        let answer = try await createAnswer(
            offer: offer,
            iceServers: iceConfiguration.iceServers,
            contributorId: contributorId
        )
        try await signaling.postAnswer(answer, to: resolved.answerURL)
        onStatus?("Waiting for Chrome")
    }

    func startDictation() {
        evaluate("window.voltBridge && window.voltBridge.startDictation()")
    }

    func stopDictation() {
        evaluate("window.voltBridge && window.voltBridge.stopDictation()")
    }

    func sendCaptureResult(
        kind: String,
        value: String,
        format: String,
        capturedAt: Date,
        contributorId: String
    ) async throws -> ScannerProtocol.ResultReceived {
        let resultId = UUID().uuidString
        let message = ScannerProtocol.captureResult(
            id: resultId,
            kind: kind,
            value: value,
            format: format,
            capturedAt: capturedAt,
            insertIntoCursor: true,
            contributorId: contributorId
        )
        let json = try encodedJavaScriptArgument([message])
        return try await withCheckedThrowingContinuation { continuation in
            resultContinuations[resultId] = continuation
            resultTimeoutTasks[resultId] = Task { [weak self] in
                try? await Task.sleep(for: .seconds(7))
                await MainActor.run {
                    self?.resumeResultContinuation(
                        resultId: resultId,
                        with: .failure(ScannerPairingError.chromeTimedOut)
                    )
                }
            }
            evaluate("window.voltBridge && window.voltBridge.sendControlMessages(\(json))")
        }
    }

    func sendPhoto(
        _ image: UIImage,
        contributorId: String,
        batchId: String? = nil,
        filename: String? = nil,
        capturedAt: Date = .now
    ) async throws -> ScannerProtocol.PhotoReceived {
        guard let data = image.jpegData(compressionQuality: 0.82) else {
            throw ScannerPairingError.invalidMessage
        }
        let photoId = ScannerProtocol.makeMessageId("photo")
        let payload = ScannerProtocol.PhotoPayload(
            id: photoId,
            batchId: batchId ?? ScannerProtocol.makeMessageId("batch"),
            filename: filename ?? "volt-clip-\(Int(capturedAt.timeIntervalSince1970 * 1000)).jpg",
            data: data,
            width: Int(image.size.width * image.scale),
            height: Int(image.size.height * image.scale),
            capturedAt: capturedAt
        )
        let base64 = data.base64EncodedString()
        let chunks = base64.chunked(maxLength: ScannerProtocol.chunkSize)
        var messages: [[String: Any]] = [
            ScannerProtocol.photoStart(payload, contributorId: contributorId, totalChunks: chunks.count),
        ]
        for (index, chunk) in chunks.enumerated() {
            messages.append(ScannerProtocol.photoChunk(photoId: payload.id, index: index, totalChunks: chunks.count, data: chunk))
        }
        messages.append(ScannerProtocol.photoComplete(photoId: payload.id, totalChunks: chunks.count))
        let json = try encodedJavaScriptArgument(messages)
        return try await withCheckedThrowingContinuation { continuation in
            photoContinuations[payload.id] = continuation
            photoTimeoutTasks[payload.id] = Task { [weak self] in
                try? await Task.sleep(for: ScannerProtocol.photoReceiptTimeout)
                await MainActor.run {
                    self?.resumePhotoContinuation(
                        photoId: payload.id,
                        with: .failure(ScannerPairingError.photoDeliveryTimedOut)
                    )
                }
            }
            evaluate("window.voltBridge && window.voltBridge.sendPhotoMessages(\(json))")
        }
    }

    func close() {
        evaluate("window.voltBridge && window.voltBridge.close()")
        failPendingReceipts(with: ScannerPairingError.channelNotOpen)
        onClosed?()
    }

    private func resolvePairing(
        _ session: PairingSession,
        contributorId: String
    ) async throws -> (offer: String, answerURL: URL, sessionId: String?, signalURL: URL) {
        let signalURL = session.signalURL ?? ScannerProtocol.signalURL
        if let offer = session.offer, let answerURL = session.answerURL {
            return (offer, answerURL, session.sessionId, signalURL)
        }
        guard let token = session.token else {
            throw ScannerPairingError.missingPairingURL
        }
        let resolvedAttempt = try await signaling.createJoinAttemptResolvingSignalURL(
            token: token,
            contributorId: contributorId,
            preferredSignalURL: signalURL,
            allowFallback: session.signalURL == nil
        )
        let resolved = try await signaling.pollOffer(token: token, attempt: resolvedAttempt.attempt)
        return (resolved.offer, resolved.answerURL, resolved.sessionId, resolvedAttempt.signalURL)
    }

    private func createAnswer(
        offer: ScannerProtocol.SessionDescription,
        iceServers: [ScannerProtocol.IceServer],
        contributorId: String
    ) async throws -> ScannerProtocol.SessionDescription {
        try await ensureLoaded()
        return try await withCheckedThrowingContinuation { continuation in
            answerContinuation = continuation
            do {
                let payload: [String: Any] = [
                    "offer": ["type": offer.type, "sdp": offer.sdp],
                    "iceServers": iceServers.map { server in
                        var value: [String: Any] = ["urls": server.urls]
                        if let username = server.username {
                            value["username"] = username
                        }
                        if let credential = server.credential {
                            value["credential"] = credential
                        }
                        return value
                    },
                    "contributorId": contributorId,
                    "protocolVersion": [
                        "major": ScannerProtocol.protocolVersion.major,
                        "minor": ScannerProtocol.protocolVersion.minor,
                        "patch": ScannerProtocol.protocolVersion.patch ?? 0,
                    ],
                    "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.1",
                    "deviceLabel": UIDevice.current.name,
                ]
                let json = try encodedJavaScriptArgument(payload)
                evaluate("window.voltBridge.start(\(json))")
            } catch {
                answerContinuation = nil
                continuation.resume(throwing: error)
            }
        }
    }

    private func ensureLoaded() async throws {
        if isLoaded { return }
        let webView = embeddedWebView
        guard let url = Bundle.main.url(forResource: "webrtc-bridge", withExtension: "html") else {
            throw ScannerPairingError.missingPairingURL
        }
        let accessURL = url.deletingLastPathComponent()
        try await withCheckedThrowingContinuation { continuation in
            loadContinuation = continuation
            do {
                let html = try String(contentsOf: url, encoding: .utf8)
                webView.loadHTMLString(Self.bridgeHTMLWithControlSender(html), baseURL: accessURL)
            } catch {
                loadContinuation = nil
                continuation.resume(throwing: error)
            }
        }
    }

    private func makeWebView() -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(self, name: "voltClip")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        return view
    }

    private func handleMessage(_ body: Any) {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return }
        switch type {
        case "status":
            onStatus?(message["value"] as? String ?? "")
        case "answer":
            guard let answer = message["answer"] as? [String: Any],
                  let type = answer["type"] as? String,
                  let sdp = answer["sdp"] as? String else { return }
            answerContinuation?.resume(returning: ScannerProtocol.SessionDescription(type: type, sdp: sdp))
            answerContinuation = nil
        case "controlMessage":
            guard let value = message["value"] as? String else { return }
            handleControlMessage(value)
        case "transcript":
            onTranscript?(message["text"] as? String ?? "", message["final"] as? Bool ?? false)
        case "closed":
            failPendingReceipts(with: ScannerPairingError.channelNotOpen)
            onClosed?()
        case "error":
            onError?(message["message"] as? String ?? "WebRTC failed")
            answerContinuation?.resume(throwing: ScannerPairingError.requestFailed)
            answerContinuation = nil
            failPendingReceipts(with: ScannerPairingError.channelNotOpen)
        default:
            break
        }
    }

    private func handleControlMessage(_ rawValue: String) {
        if let sessionReady = ScannerProtocol.parseSessionReady(rawValue) {
            onConnected?(sessionReady)
            return
        }
        if let dictationTranscript = ScannerProtocol.parseDictationTranscript(rawValue) {
            onTranscript?(dictationTranscript.text ?? "", dictationTranscript.phase == "final")
            return
        }
        if let receipt = ScannerProtocol.parseResultReceived(rawValue) {
            resumeResultContinuation(resultId: receipt.resultId, with: .success(receipt))
            onStatus?(receipt.insertedIntoCursor == true ? "Inserted into Chrome" : "Chrome received it, but no cursor target was available.")
            return
        }
        if let receipt = ScannerProtocol.parsePhotoReceived(rawValue) {
            resumePhotoContinuation(photoId: receipt.photoId, with: .success(receipt))
            onStatus?("Photo delivered")
            return
        }
        if let rejected = ScannerProtocol.parsePhotoRejected(rawValue) {
            resumePhotoContinuation(
                photoId: rejected.photoId,
                with: .failure(ScannerPairingError.photoRejected(rejected.reason))
            )
            return
        }
        if let protocolError = ScannerProtocol.parseProtocolError(rawValue) {
            onError?(protocolError.detail ?? "Chrome reported \(protocolError.code).")
        }
    }

    private func evaluate(_ source: String) {
        webView?.evaluateJavaScript(Self.supportedResultScript(for: source)) { [weak self] _, error in
            guard let error else { return }
            Task { @MainActor in
                self?.onError?(error.localizedDescription)
            }
        }
    }

    private func resumeResultContinuation(
        resultId: String,
        with result: Result<ScannerProtocol.ResultReceived, Error>
    ) {
        guard let continuation = resultContinuations.removeValue(forKey: resultId) else { return }
        resultTimeoutTasks.removeValue(forKey: resultId)?.cancel()
        continuation.resume(with: result)
    }

    private func resumePhotoContinuation(
        photoId: String,
        with result: Result<ScannerProtocol.PhotoReceived, Error>
    ) {
        guard let continuation = photoContinuations.removeValue(forKey: photoId) else { return }
        photoTimeoutTasks.removeValue(forKey: photoId)?.cancel()
        continuation.resume(with: result)
    }

    private func failPendingReceipts(with error: Error) {
        let pendingResultContinuations = resultContinuations
        self.resultContinuations.removeAll()
        resultTimeoutTasks.values.forEach { $0.cancel() }
        resultTimeoutTasks.removeAll()
        for continuation in pendingResultContinuations.values {
            continuation.resume(throwing: error)
        }

        let pendingPhotoContinuations = photoContinuations
        self.photoContinuations.removeAll()
        photoTimeoutTasks.values.forEach { $0.cancel() }
        photoTimeoutTasks.removeAll()
        for continuation in pendingPhotoContinuations.values {
            continuation.resume(throwing: error)
        }
    }

    private func encodedJavaScriptArgument(_ value: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value)
        return String(data: data, encoding: .utf8) ?? "null"
    }

    private static func bridgeHTMLWithControlSender(_ html: String) -> String {
        let marker = "          sendPhotoMessages(messages) {"
        guard html.contains(marker), !html.contains("sendControlMessages(messages)") else {
            return html
        }

        let sender = """
          sendControlMessages(messages) {
            if (!controlChannel || controlChannel.readyState !== "open") {
              post({ type: "error", message: "Control channel is not open." });
              return;
            }
            for (const message of messages || []) {
              controlChannel.send(JSON.stringify(message));
            }
            status("Capture sent");
          },

"""
        return html.replacingOccurrences(of: marker, with: sender + marker)
    }

    private static func supportedResultScript(for source: String) -> String {
        """
        (() => {
          try {
            const result = \(source);
            if (result && typeof result.catch === "function") {
              result.catch((error) => {
                window.webkit.messageHandlers.voltClip.postMessage({
                  type: "error",
                  message: error && (error.message || String(error)) || "JavaScript command failed"
                });
              });
            }
            return true;
          } catch (error) {
            window.webkit.messageHandlers.voltClip.postMessage({
              type: "error",
              message: error && (error.message || String(error)) || "JavaScript command failed"
            });
            return false;
          }
        })()
        """
    }
}

extension WebKitWebRTCTransport: WKNavigationDelegate {
    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            isLoaded = true
            loadContinuation?.resume()
            loadContinuation = nil
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            loadContinuation?.resume(throwing: error)
            loadContinuation = nil
        }
    }
}

extension WebKitWebRTCTransport: WKUIDelegate {
    nonisolated func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void
    ) {
        Task { @MainActor in
            decisionHandler(.grant)
        }
    }
}

extension WebKitWebRTCTransport: WKScriptMessageHandler {
    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        Task { @MainActor in
            handleMessage(message.body)
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
