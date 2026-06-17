import Observation
import CoreImage
import CoreImage.CIFilterBuiltins
import Security
import UIKit

@MainActor
@Observable
final class ScannerStore {
    private static let pairedSessionsStorageKey = "volt.pairedScannerSessions.v2"

    private let ocrCaptureMaxDimension: CGFloat = 1800
    private let photoLongEdge: CGFloat = 2200
    private let dictationRequestLimit: Duration = .seconds(55)

    var activeMode: CaptureMode = .ocr
    var pairingSession: PairingSession?
    var pairedSessions: [PairedScannerSession] = []
    var connectionStatus: ScannerConnectionStatus = .idle
    var peerTarget: ScannerPeerTarget?
    var results: [ScanResult] = []
    var statusText = "Not paired"
    var targetHint = ScannerStore.disconnectedPairingHint
    var ocrReviewImage: UIImage?
    var ocrReviewText = ""
    var ocrTextRegions: [RecognizedTextRegion] = []
    var isRecognizingText = false

    let camera = CameraModel()
    let dictation = DictationModel()
    let contributorId = ScannerProtocol.makeContributorId()

    static let disconnectedPairingHint = "Use the Pair button next to the section title to connect to Chrome."

    init() {
        loadPairedSessions()
        dictation.onTranscriptChange = { [weak self] text in
            self?.handleDictationTranscriptChange(text)
        }
    }

    @ObservationIgnored private lazy var connection: ScannerWebRTCConnection = {
        let connection = ScannerWebRTCConnection(contributorId: contributorId)
        connection.onStatusChange = { [weak self] status in
            self?.applyConnectionStatus(status)
        }
        connection.onSessionReady = { [weak self] message in
            self?.applySessionReady(message)
        }
        return connection
    }()
    @ObservationIgnored private let signaling = ScannerSignalingClient()
    private var lastBarcodeValue: String?
    private var lastBarcodeSentAt: Date?
    private var photoBatch: (id: String, expiresAt: Date)?
    private var dictationSessionId: String?
    private var lastDictationPartialText = ""
    private var dictationStartToken: UUID?
    private var shouldStopDictationAfterStart = false
    @ObservationIgnored private var dictationLimitTask: Task<Void, Never>?
    private var lastAutomaticReconnectAt: Date?
    private var lastPairingCandidateValue: String?
    @ObservationIgnored private let pairingImpactFeedback = UIImpactFeedbackGenerator(style: .medium)
    @ObservationIgnored private let pairingNotificationFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored private let dictationImpactFeedback = UIImpactFeedbackGenerator(style: .light)
    @ObservationIgnored private let dictationNotificationFeedback = UINotificationFeedbackGenerator()

    func handleIncomingURL(_ url: URL) {
        let parsed = PairingURLParser.parse(url)
        if let session = parsed.0 {
            pairingSession = session
            Task { await pair(with: session) }
        }
        if let mode = parsed.1 {
            activeMode = mode
        }
    }

    func saveBarcodeIfNeeded() {
        guard let value = camera.lastBarcode, !value.isEmpty else { return }
        if handlePairingValue(value) { return }
        guard activeMode == .barcode else { return }
        let now = Date.now
        if lastBarcodeValue == value,
           let lastBarcodeSentAt,
           now.timeIntervalSince(lastBarcodeSentAt) < 1.5 {
            return
        }

        lastBarcodeValue = value
        lastBarcodeSentAt = now
        let result = ScanResult(
            kind: .barcode,
            value: value,
            format: normalizedBarcodeFormat(camera.lastBarcodeFormat ?? "barcode"),
            capturedAt: now,
            deliveryState: initialDeliveryState
        )
        results.insert(result, at: 0)
        sendCaptureResult(result, insertIntoCursor: true)
    }

    @discardableResult
    func pairScannedBarcodeIfNeeded() -> Bool {
        guard let value = camera.lastBarcode, !value.isEmpty else { return false }
        guard lastPairingCandidateValue != value else { return false }
        lastPairingCandidateValue = value
        pairingImpactFeedback.impactOccurred(intensity: 0.72)
        if handlePairingValue(value) {
            return true
        }

        statusText = isDetectedQRCode ? "QR code found" : "Barcode found"
        targetHint = "That code is not a Chrome scanner pairing QR."
        return false
    }

    func capture() async {
        switch activeMode {
        case .ocr:
            await captureTextForReview()
        case .barcode:
            saveBarcodeIfNeeded()
        case .photo:
            await captureSquarePhoto()
        case .dictation:
            break
        }
    }

    func captureTextForReview() async {
        guard !isRecognizingText else { return }
        isRecognizingText = true
        defer { isRecognizingText = false }
        guard let image = await camera.capturePhoto() else { return }

        let normalizedImage = image.normalizedForProcessing()
        let preparedImage = normalizedImage
            .croppedToVisiblePreview(
                previewSize: camera.previewLayer.bounds.size
            )
            .cleanedForOCR()
            .resized(maxLongEdge: ocrCaptureMaxDimension)
        ocrReviewImage = preparedImage
        do {
            ocrTextRegions = try await TextRecognizer.recognizeTextRegions(in: preparedImage)
            ocrReviewText = ocrTextRegions.map(\.text).joined(separator: "\n")
            if handlePairingValue(ocrReviewText) {
                clearOcrReview()
            } else if ocrTextRegions.isEmpty {
                statusText = "No text found"
            }
        } catch {
            ocrReviewText = ""
            ocrTextRegions = []
            statusText = error.localizedDescription
        }
    }

    func clearOcrReview() {
        ocrReviewImage = nil
        ocrReviewText = ""
        ocrTextRegions = []
    }

    func sendOcrReviewText() {
        let text = ocrReviewText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if handlePairingValue(text) { return }
        sendRecognizedText(text, format: "live-text")
    }

    func sendRecognizedText(_ text: String, format: String = "ocr-region") {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if handlePairingValue(text) { return }
        let result = ScanResult(kind: .text, value: text, format: format, deliveryState: initialDeliveryState)
        results.insert(result, at: 0)
        sendCaptureResult(result, insertIntoCursor: true)
        statusText = connectionStatus.isConnected ? "Text sent" : "Text saved"
    }

    func captureSquarePhoto() async {
        guard let image = await camera.capturePhoto() else { return }
        let preparedImage = image
            .normalizedForProcessing()
            .croppedToVisiblePreview(previewSize: camera.previewLayer.bounds.size)
            .resized(maxLongEdge: photoLongEdge)
        let photoResult = ScanResult(
            kind: .photo,
            value: "Photo",
            format: preparedImage.sizeDescription,
            deliveryState: initialDeliveryState,
            imageData: preparedImage.previewJPEGData()
        )
        results.insert(photoResult, at: 0)
        await sendPhoto(preparedImage, resultId: photoResult.id)
    }

    func uploadPhotos(_ images: [UIImage]) async {
        guard !images.isEmpty else { return }
        guard connectionStatus.isConnected else {
            statusText = "Pair with Chrome before uploading."
            return
        }

        let now = Date.now
        let batch = ScannerProtocol.makeMessageId("upload-batch")
        photoBatch = (batch, now.addingTimeInterval(5 * 60))
        statusText = "Preparing \(images.count) upload\(images.count == 1 ? "" : "s")"

        for (index, image) in images.enumerated() {
            let preparedImage = image
                .normalizedForProcessing()
                .resized(maxLongEdge: photoLongEdge)
            let capturedAt = now.addingTimeInterval(Double(index) / 1000)
            let photoResult = ScanResult(
                kind: .photo,
                source: .upload,
                value: "Upload \(index + 1)",
                format: preparedImage.sizeDescription,
                capturedAt: capturedAt,
                deliveryState: .sending,
                imageData: preparedImage.previewJPEGData(),
                batchId: batch
            )
            results.insert(photoResult, at: 0)
            statusText = "Uploading \(index + 1) of \(images.count)"
            await sendPhoto(
                preparedImage,
                resultId: photoResult.id,
                batchId: batch,
                filename: "volt-upload-\(Int(capturedAt.timeIntervalSince1970))-\(index + 1).jpg",
                capturedAt: capturedAt
            )
        }

        statusText = "Uploaded \(images.count) photo\(images.count == 1 ? "" : "s")"
    }

    func capturePhoto() async {
        await capture()
    }

    func prepareDictation() async {
        _ = await dictation.requestAccess()
    }

    func startDictation() async {
        guard connectionStatus.isConnected else { return }
        let startToken = UUID()
        dictationStartToken = startToken
        shouldStopDictationAfterStart = false
        dictation.clearTranscript()
        beginDictationSession()
        await dictation.start()
        guard dictationStartToken == startToken else { return }
        if dictation.isRecording {
            dictationNotificationFeedback.notificationOccurred(.success)
            scheduleDictationRequestLimit(for: startToken)
            if shouldStopDictationAfterStart {
                finishDictation()
            }
        } else {
            cancelDictationRequestLimit()
            sendDictation(nil, phase: "stopped")
            dictationSessionId = nil
            lastDictationPartialText = ""
            dictationNotificationFeedback.notificationOccurred(.error)
        }
    }

    func finishDictation() {
        guard dictation.isRecording else {
            shouldStopDictationAfterStart = true
            return
        }
        dictationStartToken = nil
        shouldStopDictationAfterStart = false
        cancelDictationRequestLimit()
        let wasRecording = dictation.isRecording
        dictation.stop()
        if wasRecording {
            dictationImpactFeedback.impactOccurred(intensity: 0.7)
        }
        commitDictation()
    }

    func commitDictation() {
        let text = dictation.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            let result = ScanResult(kind: .dictation, source: .dictation, value: text, format: "dictation", deliveryState: initialDeliveryState)
            results.insert(result, at: 0)
            sendDictation(text, phase: "final")
        }
        sendDictation(nil, phase: "stopped")
        dictationSessionId = nil
        lastDictationPartialText = ""
    }

    func beginDictationSession() {
        dictation.clearTranscript()
        dictationSessionId = ScannerProtocol.makeMessageId("dictation")
        lastDictationPartialText = ""
        sendDictation(nil, phase: "started")
    }

    func reconnect(to pairedSession: PairedScannerSession, reportsErrors: Bool = true) {
        peerTarget = ScannerPeerTarget(
            chromeSessionId: pairedSession.browserSessionId,
            sessionLabel: pairedSession.displayName,
            tabTitle: pairedSession.displayName,
            tabURL: nil,
            cursorLabel: nil,
            browser: "Chrome"
        )
        Task { await reconnectWithSavedPairing(pairedSession, reportsErrors: reportsErrors) }
    }

    func reconnectToMostRecentPairedSessionIfNeeded() {
        switch connectionStatus {
        case .idle, .disconnected:
            break
        case .pairing, .waitingForChrome, .connected, .error:
            return
        }

        let now = Date.now
        if let lastAutomaticReconnectAt,
           now.timeIntervalSince(lastAutomaticReconnectAt) < 15 {
            return
        }

        guard let latestSession = pairedSessions.first else { return }
        lastAutomaticReconnectAt = now
        reconnect(to: latestSession, reportsErrors: false)
    }

    func removePairedSession(_ pairedSession: PairedScannerSession) {
        pairedSessions.removeAll { $0.id == pairedSession.id }
        PairingSecretStore.delete(pairingId: pairedSession.id)
        persistPairedSessions()
    }

    func pruneExpiredPairedSessions(now: Date = .now) {
        _ = now
    }

    func removeResult(id: ScanResult.ID) {
        results.removeAll { $0.id == id }
    }

    func removeResults(at offsets: IndexSet) {
        results.remove(atOffsets: offsets)
    }

    func unpair() {
        connection.close()
        pairingSession = nil
        peerTarget = nil
        dictationSessionId = nil
        applyConnectionStatus(.disconnected)
    }

    private func pair(with session: PairingSession) async {
        do {
            connection.close()
            try await connection.pair(with: session)
        } catch {
            applyConnectionStatus(.error(error.localizedDescription))
        }
    }

    private func reconnectWithSavedPairing(_ pairedSession: PairedScannerSession, reportsErrors: Bool) async {
        guard let secret = PairingSecretStore.secret(pairingId: pairedSession.id) else {
            removePairedSession(pairedSession)
            if reportsErrors {
                applyConnectionStatus(.error("Pairing secret missing. Scan the Chrome QR again."))
            } else {
                applyAutomaticReconnectUnavailable(for: pairedSession)
            }
            return
        }

        do {
            applyConnectionStatus(.pairing)
            try await signaling.registerPairing(
                pairingId: pairedSession.id,
                pairingSecret: secret,
                browserSessionId: pairedSession.browserSessionId,
                displayName: pairedSession.displayName,
                phoneDeviceId: contributorId
            )
            let joinWindow = try await signaling.requestReconnect(pairingId: pairedSession.id, pairingSecret: secret)
            let session = PairingSession(
                token: joinWindow.token,
                sessionId: joinWindow.sessionId ?? pairedSession.browserSessionId,
                attemptId: nil,
                offer: nil,
                answerURL: nil,
                sourceURL: joinWindow.sourceURL
            )
            pairingSession = session
            await pair(with: session)
        } catch {
            if reportsErrors {
                applyConnectionStatus(.error(error.localizedDescription))
            } else {
                applyAutomaticReconnectUnavailable(for: pairedSession)
            }
        }
    }

    private func applyAutomaticReconnectUnavailable(for pairedSession: PairedScannerSession) {
        connectionStatus = .disconnected
        statusText = "Chrome not reachable"
        targetHint = "Open \(pairedSession.displayName) in Chrome to reconnect, or tap the session button to try again."
    }

    private func applyConnectionStatus(_ status: ScannerConnectionStatus) {
        connectionStatus = status
        switch status {
        case .idle:
            statusText = "Not paired"
            targetHint = Self.disconnectedPairingHint
        case .pairing:
            statusText = "QR read"
            targetHint = "Creating the secure Chrome connection..."
            pairingImpactFeedback.impactOccurred(intensity: 0.85)
        case .waitingForChrome:
            statusText = "Chrome is responding"
            targetHint = "Waiting for the browser to finish the WebRTC handshake."
            pairingImpactFeedback.impactOccurred(intensity: 0.55)
        case .connected:
            statusText = "Connected to Chrome"
            targetHint = peerTarget?.displayText ?? "Ready to send captures."
            pairingNotificationFeedback.notificationOccurred(.success)
        case .disconnected:
            statusText = "Disconnected"
            targetHint = Self.disconnectedPairingHint
        case .error(let message):
            statusText = "Pairing failed"
            targetHint = message
            pairingNotificationFeedback.notificationOccurred(.error)
        }
    }

    private func applySessionReady(_ message: ScannerProtocol.SessionReady) {
        if let activeMode = message.activeMode {
            self.activeMode = activeMode
        }
        let chromeSessionId = message.peer?.chromeSessionId ?? message.pairing?.browserSessionId ?? pairingSession?.sessionId
        let sessionLabel = firstNonEmpty(
            message.peer?.deviceLabel,
            message.pairing?.displayName,
            peerTarget?.sessionLabel,
            savedSessionLabel(sessionId: chromeSessionId)
        )
        peerTarget = ScannerPeerTarget(
            chromeSessionId: chromeSessionId,
            sessionLabel: sessionLabel,
            tabTitle: message.cursorTarget?.tabTitle,
            tabURL: message.cursorTarget?.url,
            cursorLabel: message.cursorTarget?.label,
            browser: "Chrome"
        )
        saveCurrentPairingSession(message: message)
        applyConnectionStatus(.connected)
    }

    private func savedSessionLabel(sessionId: String?) -> String? {
        pairedSessions.first { pairedSession in
            pairedSession.browserSessionId == sessionId
        }?.displayName
    }

    private func firstNonEmpty(_ values: String?...) -> String? {
        values.first { value in
            guard let value else { return false }
            return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        } ?? nil
    }

    private func handleDictationTranscriptChange(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text != lastDictationPartialText, dictationSessionId != nil else { return }
        lastDictationPartialText = text
        sendDictation(text, phase: "partial")
    }

    private func scheduleDictationRequestLimit(for token: UUID) {
        cancelDictationRequestLimit()
        let limit = dictationRequestLimit
        dictationLimitTask = Task { [weak self] in
            try? await Task.sleep(for: limit)
            await MainActor.run {
                guard let self, self.dictationStartToken == token, self.dictation.isRecording else { return }
                self.statusText = "Dictation stopped"
                self.targetHint = "Start again to continue dictating."
                self.finishDictation()
            }
        }
    }

    private func cancelDictationRequestLimit() {
        dictationLimitTask?.cancel()
        dictationLimitTask = nil
    }

    private func loadPairedSessions() {
        guard let data = UserDefaults.standard.data(forKey: Self.pairedSessionsStorageKey),
              let decoded = try? JSONDecoder().decode([PairedScannerSession].self, from: data)
        else {
            pairedSessions = []
            return
        }
        pairedSessions = decoded
            .sorted { $0.lastConnectedAt > $1.lastConnectedAt }
    }

    private func persistPairedSessions() {
        guard let data = try? JSONEncoder().encode(pairedSessions) else { return }
        UserDefaults.standard.set(data, forKey: Self.pairedSessionsStorageKey)
    }

    private func saveCurrentPairingSession(message: ScannerProtocol.SessionReady) {
        guard let pairing = message.pairing else { return }
        let displayName = peerTarget?.sessionLabel ?? peerTarget?.tabTitle ?? pairing.displayName ?? pairing.browserSessionId
        PairingSecretStore.save(pairing.pairingSecret, pairingId: pairing.pairingId)
        let pairedSession = PairedScannerSession(
            id: pairing.pairingId,
            browserSessionId: pairing.browserSessionId,
            displayName: displayName,
            pairedAt: pairedSessions.first { $0.id == pairing.pairingId }?.pairedAt ?? .now,
            lastConnectedAt: .now
        )
        pairedSessions.removeAll { $0.id == pairedSession.id || $0.browserSessionId == pairedSession.browserSessionId }
        pairedSessions.insert(pairedSession, at: 0)
        persistPairedSessions()
        Task {
            try? await signaling.registerPairing(pairing, phoneDeviceId: contributorId)
        }
    }

    private func handlePairingValue(_ value: String) -> Bool {
        guard let url = PairingURLParser.pairingURL(in: value) else { return false }
        let parsed = PairingURLParser.parse(url)
        guard let session = parsed.0 else { return false }
        pairingSession = session
        if let mode = parsed.1 {
            activeMode = mode
        }
        Task { await pair(with: session) }
        return true
    }

    private var isDetectedQRCode: Bool {
        normalizedBarcodeFormat(camera.detectedBarcodeFormat ?? camera.lastBarcodeFormat ?? "").contains("qr")
    }

    private func sendCaptureResult(_ result: ScanResult, insertIntoCursor: Bool) {
        guard connectionStatus.isConnected else { return }
        let kind = result.kind == .barcode ? "barcode" : "text"
        do {
            try connection.sendControl(ScannerProtocol.captureResult(
                id: result.id.uuidString,
                kind: kind,
                value: result.value,
                format: result.format,
                capturedAt: result.capturedAt,
                insertIntoCursor: insertIntoCursor,
                contributorId: contributorId
            ))
            updateResultDeliveryState(id: result.id, state: .sent)
        } catch {
            updateResultDeliveryState(id: result.id, state: .failed)
            applyConnectionStatus(.error(error.localizedDescription))
        }
    }

    private func sendDictation(_ text: String?, phase: String) {
        guard connectionStatus.isConnected else { return }
        let sessionId = dictationSessionId ?? ScannerProtocol.makeMessageId("dictation")
        dictationSessionId = sessionId
        do {
            try connection.sendControl(ScannerProtocol.dictationMessage(
                sessionId: sessionId,
                phase: phase,
                text: text,
                insertIntoCursor: true
            ))
        } catch {
            applyConnectionStatus(.error(error.localizedDescription))
        }
    }

    private func sendPhoto(
        _ image: UIImage,
        resultId: ScanResult.ID,
        batchId: String? = nil,
        filename: String? = nil,
        capturedAt: Date? = nil
    ) async {
        guard connectionStatus.isConnected else { return }
        guard let data = image.jpegData(compressionQuality: 0.76) else {
            statusText = "Could not prepare photo"
            updateResultDeliveryState(id: resultId, state: .failed)
            return
        }
        let now = capturedAt ?? Date.now
        let batch = batchId ?? currentPhotoBatch(now: now)
        let payload = ScannerProtocol.PhotoPayload(
            id: ScannerProtocol.makeMessageId("photo"),
            batchId: batch,
            filename: filename ?? "volt-photo-\(Int(now.timeIntervalSince1970)).jpg",
            data: data,
            width: Int(image.size.width),
            height: Int(image.size.height),
            capturedAt: now
        )
        do {
            try await connection.sendPhoto(payload)
            updateResultDeliveryState(id: resultId, state: .sent)
            statusText = "Photo sent"
        } catch {
            updateResultDeliveryState(id: resultId, state: .failed)
            applyConnectionStatus(.error(error.localizedDescription))
        }
    }

    private var initialDeliveryState: ScanResult.DeliveryState {
        connectionStatus.isConnected ? .sending : .saved
    }

    private func updateResultDeliveryState(id: ScanResult.ID, state: ScanResult.DeliveryState) {
        guard let index = results.firstIndex(where: { $0.id == id }) else { return }
        results[index].deliveryState = state
    }

    private func currentPhotoBatch(now: Date) -> String {
        if let photoBatch, photoBatch.expiresAt > now {
            return photoBatch.id
        }
        let batch = ScannerProtocol.makeMessageId("batch")
        photoBatch = (batch, now.addingTimeInterval(5 * 60))
        return batch
    }

    private func normalizedBarcodeFormat(_ format: String) -> String {
        let rawValue = format.lowercased()
        if rawValue.contains("ean13") || rawValue.contains("ean-13") {
            return "ean13"
        }
        if rawValue.contains("upce") || rawValue.contains("upc-e") {
            return "upc_e"
        }
        if rawValue.contains("qr") {
            return "qr"
        }
        return rawValue.replacing("org.iso.", with: "")
    }
}

private extension UIImage {
    var sizeDescription: String {
        "\(Int(size.width)) x \(Int(size.height))"
    }

    func previewJPEGData() -> Data? {
        resized(maxLongEdge: 640).jpegData(compressionQuality: 0.72)
    }

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

    func croppedToVisiblePreview(previewSize: CGSize) -> UIImage {
        guard let cgImage,
              previewSize.width > 0,
              previewSize.height > 0,
              size.width > 0,
              size.height > 0
        else { return self }

        let previewAspectRatio = previewSize.width / previewSize.height
        let imageAspectRatio = size.width / size.height
        let aspectFillSize: CGSize

        if imageAspectRatio > previewAspectRatio {
            aspectFillSize = CGSize(width: size.height * previewAspectRatio, height: size.height)
        } else {
            aspectFillSize = CGSize(width: size.width, height: size.width / previewAspectRatio)
        }

        let cropOrigin = CGPoint(
            x: max(0, (size.width - aspectFillSize.width) / 2),
            y: max(0, (size.height - aspectFillSize.height) / 2)
        )
        let cropRect = CGRect(origin: cropOrigin, size: aspectFillSize)
            .applying(CGAffineTransform(scaleX: scale, y: scale))
            .integral
            .intersection(CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height))

        guard !cropRect.isNull, let cropped = cgImage.cropping(to: cropRect) else { return self }
        return UIImage(cgImage: cropped, scale: scale, orientation: .up)
    }

    func resized(maxLongEdge: CGFloat) -> UIImage {
        let longEdge = max(size.width, size.height)
        guard longEdge > maxLongEdge else { return self }
        let ratio = maxLongEdge / longEdge
        let targetSize = CGSize(width: size.width * ratio, height: size.height * ratio)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }

    func cleanedForOCR() -> UIImage {
        guard let ciImage = CIImage(image: self) else { return self }

        let colorControls = CIFilter.colorControls()
        colorControls.inputImage = ciImage
        colorControls.saturation = 0
        colorControls.contrast = 1.22
        colorControls.brightness = 0.03

        let sharpen = CIFilter.sharpenLuminance()
        sharpen.inputImage = colorControls.outputImage
        sharpen.sharpness = 0.45

        guard
            let output = sharpen.outputImage,
            let cgImage = CIContext(options: [.useSoftwareRenderer: false]).createCGImage(output, from: output.extent)
        else {
            return self
        }

        return UIImage(cgImage: cgImage, scale: scale, orientation: .up)
    }
}

private enum PairingSecretStore {
    private static let service = "com.volt.scanner.pairing"

    static func save(_ secret: String, pairingId: String) {
        guard let data = secret.data(using: .utf8) else { return }
        delete(pairingId: pairingId)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: pairingId,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func secret(pairingId: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: pairingId,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    static func delete(pairingId: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: pairingId,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
