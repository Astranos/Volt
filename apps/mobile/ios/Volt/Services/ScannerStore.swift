import Observation
import CoreImage
import CoreImage.CIFilterBuiltins
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
    var ocrTextRegions: [RecognizedTextRegion] = []
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
    private var lastAutomaticReconnectAt: Date?

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

    func startDictation() async {
        guard connectionStatus.isConnected else { return }
        dictation.clearTranscript()
        beginDictationSession()
        await dictation.start()
    }

    func finishDictation() {
        dictation.stop()
        commitDictation()
    }

    func commitDictation() {
        let text = dictation.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            let result = ScanResult(kind: .dictation, value: text, format: "dictation", deliveryState: initialDeliveryState)
            results.insert(result, at: 0)
            sendDictation(text, phase: "final")
        }
        sendDictation(nil, phase: "stopped")
        dictationSessionId = nil
    }

    func beginDictationSession() {
        dictation.clearTranscript()
        dictationSessionId = ScannerProtocol.makeMessageId("dictation")
        sendDictation(nil, phase: "started")
    }

    func reconnect(to pairedSession: PairedScannerSession) {
        pruneExpiredPairedSessions()
        guard !pairedSession.isExpired() else {
            removePairedSession(pairedSession)
            statusText = "Session expired"
            targetHint = "Scan the Chrome QR again to create a new pairing."
            return
        }

        let session = pairedSession.pairingSession
        pairingSession = session
        peerTarget = ScannerPeerTarget(
            chromeSessionId: pairedSession.sessionId,
            sessionLabel: pairedSession.displayName,
            tabTitle: pairedSession.displayName,
            tabURL: nil,
            cursorLabel: nil,
            browser: "Chrome"
        )
        Task { await pair(with: session) }
    }

    func reconnectToMostRecentPairedSessionIfNeeded() {
        switch connectionStatus {
        case .idle, .disconnected, .error:
            break
        case .pairing, .waitingForChrome, .connected:
            return
        }

        let now = Date.now
        if let lastAutomaticReconnectAt,
           now.timeIntervalSince(lastAutomaticReconnectAt) < 15 {
            return
        }

        pruneExpiredPairedSessions(now: now)
        guard let latestSession = pairedSessions.first else { return }
        lastAutomaticReconnectAt = now
        reconnect(to: latestSession)
    }

    func removePairedSession(_ pairedSession: PairedScannerSession) {
        pairedSessions.removeAll { $0.id == pairedSession.id }
        persistPairedSessions()
    }

    func pruneExpiredPairedSessions(now: Date = .now) {
        let activeSessions = pairedSessions.filter { !$0.isExpired(at: now) }
        guard activeSessions.count != pairedSessions.count else { return }
        pairedSessions = activeSessions
        persistPairedSessions()
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
            if case ScannerPairingError.joinTokenExpired = error, let token = session.token {
                removePairedSession(withToken: token)
            }
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
            chromeSessionId: message.peer?.chromeSessionId,
            sessionLabel: message.peer?.deviceLabel,
            tabTitle: message.cursorTarget?.tabTitle,
            tabURL: message.cursorTarget?.url,
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
        pairedSessions = decoded
            .filter { !$0.isExpired() }
            .sorted { $0.lastConnectedAt > $1.lastConnectedAt }
        if pairedSessions.count != decoded.count {
            persistPairedSessions()
        }
    }

    private func persistPairedSessions() {
        guard let data = try? JSONEncoder().encode(pairedSessions) else { return }
        UserDefaults.standard.set(data, forKey: Self.pairedSessionsStorageKey)
    }

    private func removePairedSession(withToken token: String) {
        pairedSessions.removeAll { $0.token == token }
        persistPairedSessions()
    }

    private func saveCurrentPairingSession() {
        guard let pairingSession, let token = pairingSession.token else { return }
        let displayName = peerTarget?.sessionLabel ?? peerTarget?.tabTitle ?? pairingSession.sessionId ?? "Chrome session"
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
        pruneExpiredPairedSessions()
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
