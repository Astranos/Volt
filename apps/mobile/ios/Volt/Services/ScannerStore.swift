import Observation
import UIKit

@MainActor
@Observable
final class ScannerStore {
    private static let pairedSessionsStorageKey = "volt.pairedScannerSessions.v1"

    private let ocrCaptureMaxDimension: CGFloat = 1800
    private let photoLongEdge: CGFloat = 2200

    var activeMode: CaptureMode = .ocr
    var pairingSession: PairingSession?
    var pairedSessions: [PairedScannerSession] = []
    var connectionStatus: ScannerConnectionStatus = .idle
    var peerTarget: ScannerPeerTarget?
    var results: [ScanResult] = []
    var statusText = "Not paired"
    var targetHint = "Tap Pair to reconnect or scan the Chrome QR once."
    var ocrReviewImage: UIImage?
    var ocrReviewText = ""
    var isRecognizingText = false

    let camera = CameraModel()
    let dictation = DictationModel()
    let contributorId = ScannerProtocol.makeContributorId()

    init() {
        loadPairedSessions()
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
    private var lastBarcodeValue: String?
    private var lastBarcodeSentAt: Date?
    private var photoBatch: (id: String, expiresAt: Date)?
    private var dictationSessionId: String?

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
        let result = ScanResult(kind: .barcode, value: value, format: normalizedBarcodeFormat(camera.lastBarcodeFormat ?? "barcode"), capturedAt: now)
        results.insert(result, at: 0)
        sendCaptureResult(result, insertIntoCursor: true)
    }

    func pairScannedBarcodeIfNeeded() {
        guard let value = camera.lastBarcode, !value.isEmpty else { return }
        _ = handlePairingValue(value)
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

        let preparedImage = image
            .normalizedForProcessing()
            .resized(maxLongEdge: ocrCaptureMaxDimension)
        ocrReviewImage = preparedImage
        do {
            ocrReviewText = try await TextRecognizer.recognizeText(in: preparedImage)
            if handlePairingValue(ocrReviewText) {
                clearOcrReview()
            }
        } catch {
            ocrReviewText = ""
            statusText = error.localizedDescription
        }
    }

    func clearOcrReview() {
        ocrReviewImage = nil
        ocrReviewText = ""
    }

    func copyOcrReviewText() {
        let text = ocrReviewText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if handlePairingValue(text) { return }
        UIPasteboard.general.string = text
        statusText = "Copied text"
    }

    func sendOcrReviewText() {
        let text = ocrReviewText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if handlePairingValue(text) { return }
        let result = ScanResult(kind: .text, value: text, format: "live-text")
        results.insert(result, at: 0)
        sendCaptureResult(result, insertIntoCursor: true)
        statusText = connectionStatus.isConnected ? "Text sent" : "Text saved"
    }

    func captureSquarePhoto() async {
        guard let image = await camera.capturePhoto() else { return }
        let preparedImage = image
            .normalizedForProcessing()
            .centerSquareCropped()
            .resized(maxLongEdge: photoLongEdge)
        let photoResult = ScanResult(kind: .photo, value: "Square photo captured", format: preparedImage.sizeDescription)
        results.insert(photoResult, at: 0)
        await sendPhoto(preparedImage)
    }

    func capturePhoto() async {
        await capture()
    }

    func commitDictation() {
        let text = dictation.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let result = ScanResult(kind: .dictation, value: text, format: "dictation")
        results.insert(result, at: 0)
        sendDictation(text, phase: "final")
        sendDictation(nil, phase: "stopped")
        dictationSessionId = nil
    }

    func beginDictationSession() {
        dictationSessionId = ScannerProtocol.makeMessageId("dictation")
        sendDictation(nil, phase: "started")
    }

    func reconnect(to pairedSession: PairedScannerSession) {
        let session = pairedSession.pairingSession
        pairingSession = session
        peerTarget = ScannerPeerTarget(
            tabTitle: pairedSession.displayName,
            cursorLabel: nil,
            browser: "Chrome"
        )
        Task { await pair(with: session) }
    }

    func removePairedSession(_ pairedSession: PairedScannerSession) {
        pairedSessions.removeAll { $0.id == pairedSession.id }
        persistPairedSessions()
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

    private func applyConnectionStatus(_ status: ScannerConnectionStatus) {
        connectionStatus = status
        switch status {
        case .idle:
            statusText = "Not paired"
            targetHint = "Tap Pair to reconnect or scan the Chrome QR once."
        case .pairing:
            statusText = "Pairing with Chrome"
            targetHint = "Keep the Chrome scanner panel open."
        case .waitingForChrome:
            statusText = "Waiting for Chrome"
            targetHint = "Chrome is opening a secure scanner channel."
        case .connected:
            statusText = "Connected to Chrome"
            targetHint = peerTarget?.displayText ?? "Ready to send captures."
        case .disconnected:
            statusText = "Disconnected"
            targetHint = "Tap Pair to reconnect to a saved computer."
        case .error(let message):
            statusText = "Pairing failed"
            targetHint = message
        }
    }

    private func applySessionReady(_ message: ScannerProtocol.SessionReady) {
        if let activeMode = message.activeMode {
            self.activeMode = activeMode
        }
        peerTarget = ScannerPeerTarget(
            tabTitle: message.cursorTarget?.tabTitle,
            cursorLabel: message.cursorTarget?.label,
            browser: "Chrome"
        )
        saveCurrentPairingSession()
        applyConnectionStatus(.connected)
    }

    private func loadPairedSessions() {
        guard let data = UserDefaults.standard.data(forKey: Self.pairedSessionsStorageKey),
              let decoded = try? JSONDecoder().decode([PairedScannerSession].self, from: data)
        else {
            pairedSessions = []
            return
        }
        pairedSessions = decoded.sorted { $0.lastConnectedAt > $1.lastConnectedAt }
    }

    private func persistPairedSessions() {
        guard let data = try? JSONEncoder().encode(pairedSessions) else { return }
        UserDefaults.standard.set(data, forKey: Self.pairedSessionsStorageKey)
    }

    private func saveCurrentPairingSession() {
        guard let pairingSession, let token = pairingSession.token else { return }
        let displayName = peerTarget?.tabTitle ?? pairingSession.sessionId ?? "Chrome session"
        let pairedSession = PairedScannerSession(
            id: pairingSession.sessionId ?? token,
            token: token,
            sessionId: pairingSession.sessionId,
            sourceURL: pairingSession.sourceURL,
            displayName: displayName,
            lastConnectedAt: .now
        )
        pairedSessions.removeAll { $0.id == pairedSession.id || $0.token == token }
        pairedSessions.insert(pairedSession, at: 0)
        persistPairedSessions()
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
        } catch {
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

    private func sendPhoto(_ image: UIImage) async {
        guard connectionStatus.isConnected else { return }
        guard let data = image.jpegData(compressionQuality: 0.76) else {
            statusText = "Could not prepare photo"
            return
        }
        let now = Date.now
        let batch = currentPhotoBatch(now: now)
        let payload = ScannerProtocol.PhotoPayload(
            id: ScannerProtocol.makeMessageId("photo"),
            batchId: batch,
            filename: "volt-photo-\(Int(now.timeIntervalSince1970)).jpg",
            data: data,
            width: Int(image.size.width),
            height: Int(image.size.height),
            capturedAt: now
        )
        do {
            try await connection.sendPhoto(payload)
            statusText = "Photo sent"
        } catch {
            applyConnectionStatus(.error(error.localizedDescription))
        }
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
}
