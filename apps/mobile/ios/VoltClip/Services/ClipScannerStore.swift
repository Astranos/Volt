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

    var selectedTab: ClipTab = .capture
    var activeCaptureMode: CaptureMode = .ocr
    var pairingURLText = ""
    var statusText = "Open Volt in Chrome and scan the pairing code."
    var targetHint = "Not connected"
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
    @ObservationIgnored private let transport = WebKitWebRTCTransport()
    private var pairingSession: PairingSession?

    var bridgeWebView: WKWebView {
        transport.embeddedWebView
    }

    init() {
        transport.onStatus = { [weak self] status in
            self?.statusText = status
        }
        transport.onConnected = { [weak self] sessionReady in
            self?.isConnected = true
            self?.isPairing = false
            self?.targetHint = sessionReady.cursorTarget?.label ?? "Ready for Chrome"
            self?.statusText = "Connected to Chrome"
            self?.sendSavedItemsAfterConnect()
        }
        transport.onTranscript = { [weak self] text, final in
            self?.transcript = text
            if final {
                self?.statusText = "Dictation recognized"
            }
        }
        transport.onClosed = { [weak self] in
            self?.isConnected = false
            self?.isDictating = false
            self?.targetHint = "Disconnected"
            self?.statusText = "Connection closed"
        }
        transport.onError = { [weak self] message in
            self?.isPairing = false
            self?.isDictating = false
            self?.errorMessage = message
            self?.statusText = self?.isConnected == true ? "Dictation failed" : "Connection failed"
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
            return
        }

        isPairing = true
        errorMessage = nil
        statusText = "Pairing with Chrome"
        do {
            try await transport.pair(with: nextSession, contributorId: contributorId)
        } catch {
            isPairing = false
            errorMessage = error.localizedDescription
            statusText = "Pairing failed"
        }
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
    }

    func stopDictation() {
        isDictating = false
        transport.stopDictation()
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
        } catch {
            updatePhoto(photo.id, status: "Failed")
            errorMessage = error.localizedDescription
            statusText = "Photo send failed"
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
        transport.close()
        isConnected = false
        isDictating = false
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
            }
        }
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
