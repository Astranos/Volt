import Foundation
import Observation
import SwiftUI
import UIKit
import WebKit

@MainActor
@Observable
final class ClipScannerStore {
    enum ClipTab: String, CaseIterable, Identifiable {
        case capture
        case dictate
        case upload

        var id: String { rawValue }

        var title: String {
            switch self {
            case .capture: "Capture"
            case .dictate: "Dictate"
            case .upload: "Upload"
            }
        }

        var systemImage: String {
            switch self {
            case .capture: "camera.viewfinder"
            case .dictate: "mic"
            case .upload: "square.and.arrow.up"
            }
        }
    }

    struct ClipPhoto: Identifiable, Equatable {
        let id = UUID()
        let image: UIImage
        let source: Source
        let batchId: String?
        let capturedAt: Date
        var status: String

        enum Source: String, Equatable {
            case capture
            case upload
        }
    }

    struct ClipCapture: Identifiable, Equatable {
        let id = UUID()
        let mode: CaptureMode
        let value: String
        let format: String
        let capturedAt: Date
        var status: String
    }

    private struct ClipPairingCredential {
        let pairingId: String
        let pairingSecret: String
        let browserSessionId: String
        let displayName: String
    }

    var selectedTab: ClipTab = .capture
    var activeCaptureMode: CaptureMode = .ocr
    var pairingURLText = ""
    var statusText = "Open Volt in Chrome and scan the pairing code."
    var targetHint = "Not connected"
    var pairingLabel: String?
    var pairingFailureMessage: String?
    var transcript = ""
    var isPairing = false
    var isConnected = false
    var isDictating = false
    var isRecognizingText = false
    var photos: [ClipPhoto] = []
    var captures: [ClipCapture] = []
    var ocrReviewImage: UIImage?
    var ocrTextRegions: [RecognizedTextRegion] = []
    var ocrReviewText = ""
    var errorMessage: String?

    private let contributorId = ScannerProtocol.makeContributorId()
    @ObservationIgnored private let ocrService = ClipOCRService()
    @ObservationIgnored private let signaling = ScannerSignalingClient()
    @ObservationIgnored private let transport = WebKitWebRTCTransport()
    @ObservationIgnored private let pairingImpactFeedback = UIImpactFeedbackGenerator(style: .medium)
    @ObservationIgnored private let pairingNotificationFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored private let dictationImpactFeedback = UIImpactFeedbackGenerator(style: .light)
    @ObservationIgnored private let dictationNotificationFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored private let captureSuccessFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored private let captureFailureFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored private let captureFailureImpactFeedback = UIImpactFeedbackGenerator(style: .heavy)
    private var pairingSession: PairingSession?
    private var reconnectTask: Task<Void, Never>?
    private var suppressNextReconnect = false
    private var lastPairingCredential: ClipPairingCredential?
    private var dictationTargetKey: String?

    var bridgeWebView: WKWebView {
        transport.embeddedWebView
    }

    func updateAppIsInBackground(_ isInBackground: Bool) {
        transport.setAppIsInBackground(isInBackground)
    }

    var canRetryPairing: Bool {
        pairingSession != nil && !isPairing && !isConnected
    }

    init() {
        transport.onStatus = { [weak self] status in
            self?.statusText = status
        }
        transport.onConnected = { [weak self] sessionReady in
            guard let self else { return }
            let wasConnected = self.isConnected
            let nextTargetKey = self.dictationTargetKey(for: sessionReady)
            let didChangeChromeInputTarget = wasConnected
                && self.dictationTargetKey != nil
                && self.dictationTargetKey != nextTargetKey
            self.savePairingCredential(from: sessionReady)
            self.dictationTargetKey = nextTargetKey
            self.isConnected = true
            self.isPairing = false
            self.pairingFailureMessage = nil
            self.targetHint = sessionReady.cursorTarget?.label ?? "Ready for Chrome"
            self.statusText = "Connected to \(self.pairingLabel ?? "Chrome")"
            if !wasConnected || (didChangeChromeInputTarget && self.selectedTab == .dictate) {
                self.pairingNotificationFeedback.notificationOccurred(.success)
            }
            self.sendSavedItemsAfterConnect()
        }
        transport.onTranscript = { [weak self] text, final in
            self?.transcript = text
            if final {
                self?.statusText = "Dictation recognized"
            }
        }
        transport.onClosed = { [weak self] in
            self?.handleTransportClosed()
        }
        transport.onError = { [weak self] message in
            guard let self else { return }
            let wasConnected = self.isConnected
            self.isPairing = false
            self.isDictating = false
            self.errorMessage = message
            if wasConnected {
                self.scheduleReconnectIfPossible(reason: "Connection interrupted")
            } else {
                self.pairingFailureMessage = message
                self.pairingNotificationFeedback.notificationOccurred(.error)
                self.statusText = "Connection failed"
            }
        }
    }

    func handleIncomingURL(_ url: URL) {
        let (session, mode) = PairingURLParser.parse(url)
        if let mode {
            selectMode(mode)
        }
        guard let session else { return }
        pairingSession = session
        pairingURLText = url.absoluteString
        pairingLabel = session.label ?? pairingLabel
        pairingFailureMessage = nil
        Task { await pair(session) }
    }

    func pairFromText() {
        guard let url = PairingURLParser.pairingURL(in: pairingURLText) ?? URL(string: pairingURLText) else {
            errorMessage = "Paste a Volt pairing URL from Chrome."
            return
        }
        handleIncomingURL(url)
    }

    func pairFromScannedValue(_ value: String) -> Bool {
        guard !isPairing, !isConnected else { return true }
        return handlePairingValue(value, invalidMessage: "That QR is not a Volt pairing QR.")
    }

    func pair(_ session: PairingSession? = nil) async {
        let nextSession = session ?? pairingSession
        guard let nextSession else {
            errorMessage = "Open a pairing link first."
            pairingFailureMessage = "Open a Volt App Clip link or scan the Chrome pairing QR."
            return
        }

        reconnectTask?.cancel()
        reconnectTask = nil
        suppressNextReconnect = false
        isPairing = true
        errorMessage = nil
        pairingFailureMessage = nil
        statusText = "Pairing with Chrome"
        pairingImpactFeedback.impactOccurred(intensity: 0.85)
        do {
            try await transport.pair(with: nextSession, contributorId: contributorId)
        } catch {
            isPairing = false
            errorMessage = error.localizedDescription
            pairingFailureMessage = error.localizedDescription
            statusText = "Pairing failed"
            pairingNotificationFeedback.notificationOccurred(.error)
        }
    }

    func retryPairing() {
        guard pairingSession != nil, !isPairing, !isConnected else { return }
        Task { await pair() }
    }

    func startDictation() {
        guard isConnected else {
            errorMessage = "Connect to Chrome first."
            statusText = "Connect to Chrome first"
            return
        }
        errorMessage = nil
        statusText = "Starting dictation"
        isDictating = true
        transcript = ""
        transport.startDictation()
        dictationNotificationFeedback.notificationOccurred(.success)
    }

    func stopDictation() {
        let wasDictating = isDictating
        isDictating = false
        transport.stopDictation()
        if wasDictating {
            dictationImpactFeedback.impactOccurred(intensity: 0.7)
        }
    }

    @discardableResult
    func addCapturedImage(_ image: UIImage, source: ClipPhoto.Source, batchId: String? = nil, capturedAt: Date = .now) -> ClipPhoto {
        let photo = ClipPhoto(
            image: image,
            source: source,
            batchId: batchId,
            capturedAt: capturedAt,
            status: isConnected ? "Sending" : "Saved until connected"
        )
        photos.insert(photo, at: 0)
        return photo
    }

    func addImportedImage(_ image: UIImage) {
        _ = addCapturedImage(image, source: .upload)
    }

    func capturePhoto(_ image: UIImage) async {
        let preparedImage = image
            .normalizedForProcessing()
            .centerSquareCropped()
            .resized(maxLongEdge: 2200)
        let photo = addCapturedImage(preparedImage, source: .capture)
        await sendPhoto(photo)
    }

    func uploadPhotos(_ images: [UIImage]) async {
        guard !images.isEmpty else { return }
        guard isConnected else {
            statusText = "Pair with Chrome before uploading."
            targetHint = "Connect to Chrome first"
            return
        }

        let now = Date.now
        let batchId = ScannerProtocol.makeMessageId("upload-batch")
        statusText = "Preparing \(images.count) upload\(images.count == 1 ? "" : "s")"

        for (index, image) in images.enumerated() {
            let capturedAt = now.addingTimeInterval(Double(index) / 1000)
            let preparedImage = image
                .normalizedForProcessing()
                .resized(maxLongEdge: 2200)
            let photo = addCapturedImage(preparedImage, source: .upload, batchId: batchId, capturedAt: capturedAt)
            statusText = "Uploading \(index + 1) of \(images.count)"
            await sendPhoto(
                photo,
                filename: uploadFilename(index: index, capturedAt: capturedAt)
            )
        }

        statusText = "Uploaded \(images.count) photo\(images.count == 1 ? "" : "s")"
    }

    func sendPhoto(_ photo: ClipPhoto, filename: String? = nil) async {
        guard isConnected else {
            errorMessage = "Connect to Chrome first."
            updatePhoto(photo.id, status: "Saved until connected")
            return
        }
        updatePhoto(photo.id, status: "Sending")
        do {
            _ = try await transport.sendPhoto(
                photo.image,
                contributorId: contributorId,
                batchId: photo.batchId,
                filename: filename ?? photoFilename(for: photo),
                capturedAt: photo.capturedAt
            )
            updatePhoto(photo.id, status: "Delivered")
            statusText = "Photo delivered"
            captureSuccessFeedback.notificationOccurred(.success)
        } catch {
            updatePhoto(photo.id, status: "Failed")
            errorMessage = error.localizedDescription
            statusText = "Photo send failed"
            playCaptureFailureFeedback()
        }
    }

    func handleBarcodeScan(_ scan: ClipBarcodeScan) {
        if scan.isQRCode, handlePairingValue(scan.value, invalidMessage: nil) {
            return
        }
        guard activeCaptureMode == .barcode else { return }
        let normalized = normalizedBarcodeScan(value: scan.value, format: scan.format)
        sendCapture(
            mode: .barcode,
            value: normalized.value,
            format: normalized.format,
            capturedAt: scan.capturedAt
        )
    }

    func recognizeText(in image: UIImage) async {
        guard !isRecognizingText else { return }
        isRecognizingText = true
        errorMessage = nil
        statusText = "Recognizing text"
        defer { isRecognizingText = false }

        do {
            let result = try await ocrService.recognizeText(in: image)
            guard !result.isEmpty else {
                ocrReviewImage = image
                ocrTextRegions = []
                ocrReviewText = ""
                statusText = "No text found"
                return
            }
            if handlePairingValue(result.text, invalidMessage: nil) {
                clearOcrReview()
                return
            }
            ocrReviewImage = image
            ocrTextRegions = result.regions
            ocrReviewText = result.text
            statusText = "Tap highlighted text"
        } catch {
            errorMessage = error.localizedDescription
            statusText = "Text recognition failed"
        }
    }

    func clearOcrReview() {
        ocrReviewImage = nil
        ocrTextRegions = []
        ocrReviewText = ""
    }

    func sendRecognizedText(_ text: String, format: String = "vision-text") {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if handlePairingValue(trimmed, invalidMessage: nil) {
            return
        }
        sendCapture(mode: .ocr, value: trimmed, format: format, capturedAt: .now)
    }

    func selectMode(_ mode: CaptureMode) {
        activeCaptureMode = mode
        selectedTab = tab(for: mode)
    }

    func disconnect() {
        suppressNextReconnect = true
        reconnectTask?.cancel()
        reconnectTask = nil
        transport.close()
        isConnected = false
        isDictating = false
        isPairing = false
        statusText = "Disconnected"
        targetHint = "Disconnected"
    }

    private func savePairingCredential(from sessionReady: ScannerProtocol.SessionReady) {
        guard let pairing = sessionReady.pairing else { return }
        let displayName = pairing.displayName ?? pairing.browserSessionId
        lastPairingCredential = ClipPairingCredential(
            pairingId: pairing.pairingId,
            pairingSecret: pairing.pairingSecret,
            browserSessionId: pairing.browserSessionId,
            displayName: displayName
        )
        pairingLabel = displayName
        Task {
            try? await signaling.registerPairing(pairing, phoneDeviceId: contributorId)
        }
    }

    private func dictationTargetKey(for sessionReady: ScannerProtocol.SessionReady) -> String {
        [
            sessionReady.peer?.chromeSessionId,
            sessionReady.cursorTarget?.url,
            sessionReady.cursorTarget?.tabTitle,
            sessionReady.cursorTarget?.label,
        ]
            .map { value in
                value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            }
            .joined(separator: "\u{1F}")
    }

    private func handleTransportClosed() {
        let shouldReconnect = isConnected && !suppressNextReconnect
        isConnected = false
        isDictating = false

        if shouldReconnect {
            scheduleReconnectIfPossible(reason: "Connection closed")
        } else {
            suppressNextReconnect = false
            targetHint = "Disconnected"
            statusText = "Connection closed"
        }
    }

    private func scheduleReconnectIfPossible(reason: String) {
        suppressNextReconnect = false
        guard reconnectTask == nil else { return }
        guard let credential = lastPairingCredential else {
            isConnected = false
            targetHint = "Scan a fresh Volt QR code."
            statusText = reason
            return
        }

        isConnected = false
        isPairing = true
        targetHint = "Reopening \(credential.displayName)"
        statusText = "Reconnecting to Chrome"
        reconnectTask = Task { [weak self] in
            await self?.reconnect(using: credential)
        }
    }

    private func reconnect(using credential: ClipPairingCredential) async {
        defer {
            reconnectTask = nil
        }

        do {
            try await signaling.registerPairing(
                pairingId: credential.pairingId,
                pairingSecret: credential.pairingSecret,
                browserSessionId: credential.browserSessionId,
                displayName: credential.displayName,
                phoneDeviceId: contributorId
            )
            let joinWindow = try await signaling.requestReconnect(
                pairingId: credential.pairingId,
                pairingSecret: credential.pairingSecret
            )
            let session = PairingSession(
                token: joinWindow.token,
                sessionId: joinWindow.sessionId ?? credential.browserSessionId,
                attemptId: nil,
                offer: nil,
                answerURL: nil,
                label: credential.displayName,
                signalURL: joinWindow.sourceURL.signalBaseURL ?? ScannerProtocol.signalURL,
                sourceURL: joinWindow.sourceURL
            )
            pairingSession = session
            try await transport.pair(with: session, contributorId: contributorId)
        } catch {
            isPairing = false
            isConnected = false
            pairingFailureMessage = error.localizedDescription
            errorMessage = error.localizedDescription
            targetHint = "Scan a fresh Volt QR code."
            statusText = "Reconnect failed"
            pairingNotificationFeedback.notificationOccurred(.error)
        }
    }

    private func updatePhoto(_ id: UUID, status: String) {
        guard let index = photos.firstIndex(where: { $0.id == id }) else { return }
        photos[index].status = status
    }

    private func sendCapture(
        mode: CaptureMode,
        value: String,
        format: String,
        capturedAt: Date
    ) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let initialStatus = isConnected ? "Sending" : "Saved until connected"
        let capture = ClipCapture(
            mode: mode,
            value: trimmed,
            format: format,
            capturedAt: capturedAt,
            status: initialStatus
        )
        captures.insert(capture, at: 0)

        guard isConnected else {
            statusText = mode == .barcode ? "Barcode saved" : "Text saved"
            return
        }

        sendCaptureToChrome(capture)
    }

    private func sendSavedItemsAfterConnect() {
        let savedCaptures = captures.filter { $0.status == "Saved until connected" }
        let savedPhotos = photos.filter { $0.status == "Saved until connected" }
        guard !savedCaptures.isEmpty || !savedPhotos.isEmpty else { return }

        for capture in savedCaptures {
            sendCaptureToChrome(capture)
        }

        Task {
            for photo in savedPhotos {
                await sendPhoto(photo)
            }
        }
    }

    private func sendCaptureToChrome(_ capture: ClipCapture) {
        updateCapture(capture.id, status: "Sending")
        Task {
            do {
                let receipt = try await transport.sendCaptureResult(
                    kind: capture.mode == .barcode ? "barcode" : "text",
                    value: capture.value,
                    format: capture.format,
                    capturedAt: capture.capturedAt,
                    contributorId: contributorId
                )
                if receipt.insertedIntoCursor == true {
                    updateCapture(capture.id, status: "Inserted")
                    statusText = capture.mode == .barcode ? "Barcode inserted" : "Text inserted"
                    captureSuccessFeedback.notificationOccurred(.success)
                } else {
                    updateCapture(capture.id, status: "Received")
                    statusText = "Chrome received it, but no cursor target was available."
                    if let label = receipt.cursorTarget?.label {
                        targetHint = label
                    }
                }
            } catch {
                updateCapture(capture.id, status: "Failed")
                errorMessage = error.localizedDescription
                statusText = "Send failed"
                playCaptureFailureFeedback()
            }
        }
    }

    private func playCaptureFailureFeedback() {
        captureFailureImpactFeedback.impactOccurred(intensity: 1)
        captureFailureFeedback.notificationOccurred(.error)
    }

    @discardableResult
    private func handlePairingValue(_ value: String, invalidMessage: String?) -> Bool {
        guard let url = PairingURLParser.pairingURL(in: value) ?? URL(string: value) else {
            if let invalidMessage {
                errorMessage = invalidMessage
            }
            return false
        }

        let (session, mode) = PairingURLParser.parse(url)
        guard let session else {
            if let invalidMessage {
                errorMessage = invalidMessage
            }
            return false
        }

        if let mode {
            selectMode(mode)
        }
        pairingSession = session
        pairingURLText = url.absoluteString
        pairingLabel = session.label ?? pairingLabel
        pairingFailureMessage = nil
        Task { await pair(session) }
        return true
    }

    private func updateCapture(_ id: UUID, status: String) {
        guard let index = captures.firstIndex(where: { $0.id == id }) else { return }
        captures[index].status = status
    }

    private func normalizedBarcodeScan(value: String, format: String) -> (value: String, format: String) {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if format == "ean13",
           trimmedValue.count == 13,
           trimmedValue.first == "0",
           trimmedValue.allSatisfy(\.isNumber) {
            return (String(trimmedValue.dropFirst()), "upc_a")
        }
        return (trimmedValue, format)
    }

    private func photoFilename(for photo: ClipPhoto) -> String {
        switch photo.source {
        case .capture:
            "volt-clip-photo-\(Int(photo.capturedAt.timeIntervalSince1970 * 1000)).jpg"
        case .upload:
            "volt-upload-\(Int(photo.capturedAt.timeIntervalSince1970 * 1000)).jpg"
        }
    }

    private func uploadFilename(index: Int, capturedAt: Date) -> String {
        let uploadNumber = String(format: "%03d", index + 1)
        let timestampMs = Int(capturedAt.timeIntervalSince1970 * 1000)
        return "volt-upload-\(uploadNumber)-\(timestampMs).jpg"
    }

    private func tab(for mode: CaptureMode) -> ClipTab {
        switch mode {
        case .dictation: .dictate
        case .photo: .upload
        case .ocr, .barcode: .capture
        }
    }
}

private extension UIImage {
    func normalizedForProcessing() -> UIImage {
        guard imageOrientation != .up else { return self }
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: size))
        }
    }

    func centerSquareCropped() -> UIImage {
        guard let cgImage else { return self }
        let side = min(cgImage.width, cgImage.height)
        let rect = CGRect(
            x: (cgImage.width - side) / 2,
            y: (cgImage.height - side) / 2,
            width: side,
            height: side
        )
        guard let cropped = cgImage.cropping(to: rect) else { return self }
        return UIImage(cgImage: cropped, scale: scale, orientation: .up)
    }

    func resized(maxLongEdge: CGFloat) -> UIImage {
        let longEdge = max(size.width, size.height)
        guard longEdge > maxLongEdge, longEdge > 0 else { return self }
        let ratio = maxLongEdge / longEdge
        let targetSize = CGSize(width: size.width * ratio, height: size.height * ratio)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }
}
