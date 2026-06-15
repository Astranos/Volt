import Observation
import UIKit

@MainActor
@Observable
final class ScannerStore {
    var activeMode: CaptureMode = .ocr
    var pairingSession: PairingSession?
    var connectionStatus: ScannerConnectionStatus = .idle
    var peerTarget: ScannerPeerTarget?
    var results: [ScanResult] = []
    var statusText = "Not paired"
    var targetHint = "Scan the QR code from the Chrome extension."

    let camera = CameraModel()
    let dictation = DictationModel()
    let contributorId = ScannerProtocol.makeContributorId()

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

    func capturePhoto() async {
        guard let image = await camera.capturePhoto() else { return }
        let photoResult = ScanResult(kind: .photo, value: "Photo captured", format: image.sizeDescription)
        results.insert(photoResult, at: 0)

        if activeMode == .ocr {
            do {
                let text = try await TextRecognizer.recognizeText(in: image)
                if !text.isEmpty {
                    let result = ScanResult(kind: .text, value: text, format: "live-text")
                    results.insert(result, at: 0)
                    sendCaptureResult(result, insertIntoCursor: true)
                }
            } catch {
                statusText = error.localizedDescription
            }
        } else {
            await sendPhoto(image)
        }
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

    private func pair(with session: PairingSession) async {
        do {
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
            targetHint = "Scan the QR code from the Chrome extension."
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
            targetHint = "Reopen the Chrome QR and scan again."
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
        applyConnectionStatus(.connected)
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
}
