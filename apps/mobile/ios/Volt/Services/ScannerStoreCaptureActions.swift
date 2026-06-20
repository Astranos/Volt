import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

@MainActor
final class MobilePhotoRetryQueue {
    static let recoveryWindow: TimeInterval = 24 * 60 * 60

    enum Status: String, Codable, Equatable {
        case queued
        case sending
        case sent
        case failed
        case received
        case cancelled
    }

    struct Entry: Codable, Equatable, Identifiable {
        let id: String
        let resultId: UUID
        let batchId: String
        let filename: String
        let width: Int
        let height: Int
        let capturedAt: Date
        let queuedAt: Date
        let expiresAt: Date
        let dataFilename: String
        var status: Status

        var isExpired: Bool {
            expiresAt <= Date.now
        }
    }

    private struct Manifest: Codable {
        var entries: [Entry]
    }

    private let fileManager: FileManager
    private let directoryURL: URL
    private let manifestURL: URL
    private(set) var entries: [Entry] = []

    init(fileManager: FileManager = .default, directoryURL: URL? = nil) {
        self.fileManager = fileManager
        let baseURL = directoryURL ?? fileManager
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first!
            .appendingPathComponent("VoltPhotoRetryQueue", isDirectory: true)
        self.directoryURL = baseURL
        self.manifestURL = baseURL.appendingPathComponent("manifest.json")
        load()
        expireEntries()
    }

    var retryableEntries: [Entry] {
        entries.filter { entry in
            !entry.isExpired && [.queued, .sent, .failed].contains(entry.status)
        }
    }

    @discardableResult
    func enqueue(payload: ScannerProtocol.PhotoPayload, resultId: UUID, now: Date = .now) -> Entry? {
        do {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            let dataFilename = "\(payload.id).jpg"
            try payload.data.write(to: directoryURL.appendingPathComponent(dataFilename), options: .atomic)
            let entry = Entry(
                id: payload.id,
                resultId: resultId,
                batchId: payload.batchId,
                filename: payload.filename,
                width: payload.width,
                height: payload.height,
                capturedAt: payload.capturedAt,
                queuedAt: now,
                expiresAt: now.addingTimeInterval(Self.recoveryWindow),
                dataFilename: dataFilename,
                status: .queued
            )
            entries.removeAll { $0.id == entry.id }
            entries.append(entry)
            save()
            return entry
        } catch {
            return nil
        }
    }

    func payload(for photoId: String) -> ScannerProtocol.PhotoPayload? {
        guard let entry = entries.first(where: { $0.id == photoId }),
              !entry.isExpired,
              let data = try? Data(contentsOf: directoryURL.appendingPathComponent(entry.dataFilename))
        else {
            markStatus(.cancelled, photoId: photoId)
            return nil
        }
        return ScannerProtocol.PhotoPayload(
            id: entry.id,
            batchId: entry.batchId,
            filename: entry.filename,
            data: data,
            width: entry.width,
            height: entry.height,
            capturedAt: entry.capturedAt
        )
    }

    func resultId(for photoId: String) -> UUID? {
        entries.first { $0.id == photoId }?.resultId
    }

    func markSending(photoId: String) {
        markStatus(.sending, photoId: photoId)
    }

    func markSent(photoId: String) {
        markStatus(.sent, photoId: photoId)
    }

    func markReceived(photoId: String) {
        markStatus(.received, photoId: photoId)
        removeData(photoId: photoId)
    }

    func markFailed(photoId: String) {
        markStatus(.failed, photoId: photoId)
    }

    func cancel(photoId: String) {
        markStatus(.cancelled, photoId: photoId)
        removeData(photoId: photoId)
    }

    @discardableResult
    func expireEntries(now: Date = .now) -> [Entry] {
        let expired = entries.filter { $0.expiresAt <= now && $0.status != .received && $0.status != .cancelled }
        for entry in expired {
            cancel(photoId: entry.id)
        }
        return expired
    }

    private func markStatus(_ status: Status, photoId: String) {
        guard let index = entries.firstIndex(where: { $0.id == photoId }) else { return }
        entries[index].status = status
        save()
    }

    private func removeData(photoId: String) {
        guard let entry = entries.first(where: { $0.id == photoId }) else { return }
        try? fileManager.removeItem(at: directoryURL.appendingPathComponent(entry.dataFilename))
    }

    private func load() {
        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = try? Self.decoder.decode(Manifest.self, from: data)
        else { return }
        entries = manifest.entries.map { entry in
            guard entry.status == .sending else { return entry }
            var retryableEntry = entry
            retryableEntry.status = .failed
            return retryableEntry
        }
    }

    private func save() {
        do {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            let data = try JSONEncoder.scanner.encode(Manifest(entries: entries))
            try data.write(to: manifestURL, options: .atomic)
        } catch {
            return
        }
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

extension ScanResult.DeliveryState {
    init(photoRetryStatus status: MobilePhotoRetryQueue.Status) {
        switch status {
        case .queued: self = .saved
        case .sending: self = .sending
        case .sent: self = .sent
        case .failed: self = .failed
        case .received: self = .sent
        case .cancelled: self = .failed
        }
    }
}

@MainActor
extension ScannerStore {
    func saveBarcodeIfNeeded() {
        guard let value = camera.lastBarcode, !value.isEmpty else { return }
        if handlePairingValue(value) { return }
        guard activeMode == .barcode else { return }
        let normalized = normalizedBarcodeScan(value: value, format: camera.lastBarcodeFormat ?? "barcode")
        let now = Date.now
        if lastBarcodeValue == normalized.value,
           let lastBarcodeSentAt,
           now.timeIntervalSince(lastBarcodeSentAt) < 1.5 {
            return
        }

        lastBarcodeValue = normalized.value
        lastBarcodeSentAt = now
        let result = ScanResult(
            kind: .barcode,
            value: normalized.value,
            format: normalized.format,
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
            deliveryState: .saved,
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
                deliveryState: .saved,
                imageData: preparedImage.previewJPEGData(),
                batchId: batch
            )
            results.insert(photoResult, at: 0)
            statusText = "Uploading \(index + 1) of \(images.count)"
            await sendPhoto(
                preparedImage,
                resultId: photoResult.id,
                batchId: batch,
                filename: uploadFilename(index: index, capturedAt: capturedAt),
                capturedAt: capturedAt
            )
        }

        statusText = "Uploaded \(images.count) photo\(images.count == 1 ? "" : "s")"
    }

    func capturePhoto() async {
        await capture()
    }

    func removeResult(id: ScanResult.ID) {
        results.removeAll { $0.id == id }
    }

    func resendResultToChrome(id: ScanResult.ID) async {
        guard let result = results.first(where: { $0.id == id }) else { return }
        guard connectionStatus.isConnected else {
            statusText = "Pair with Chrome before resending."
            targetHint = Self.disconnectedPairingHint
            return
        }

        updateResultDeliveryState(id: id, state: .sending)
        switch result.kind {
        case .barcode, .text:
            sendCaptureResult(result, insertIntoCursor: true)
            statusText = result.kind == .barcode ? "Barcode resent" : "Text resent"
        case .photo:
            guard let imageData = result.imageData, let image = UIImage(data: imageData) else {
                updateResultDeliveryState(id: id, state: .failed)
                statusText = "Photo preview unavailable"
                return
            }
            await sendPhoto(
                image,
                resultId: id,
                filename: "volt-photo-resend-\(Int(Date.now.timeIntervalSince1970)).jpg",
                capturedAt: result.capturedAt
            )
        case .dictation:
            sendDictation(result.value, phase: "final")
            updateResultDeliveryState(id: id, state: .sent)
            statusText = "Dictation resent"
        }
    }

    func removeResults(at offsets: IndexSet) {
        results.remove(atOffsets: offsets)
    }

    func handlePairingValue(_ value: String) -> Bool {
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

    var isDetectedQRCode: Bool {
        normalizedBarcodeFormat(camera.detectedBarcodeFormat ?? camera.lastBarcodeFormat ?? "").contains("qr")
    }

    func sendCaptureResult(_ result: ScanResult, insertIntoCursor: Bool) {
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
            updateResultDeliveryState(id: result.id, state: .sending)
        } catch {
            updateResultDeliveryState(id: result.id, state: .failed)
            playCaptureFailureFeedback()
            showCaptureDeliveryToast(for: result, state: .failed)
            applyConnectionStatus(.error(error.localizedDescription))
        }
    }

    func sendPhoto(
        _ image: UIImage,
        resultId: ScanResult.ID,
        batchId: String? = nil,
        filename: String? = nil,
        capturedAt: Date? = nil
    ) async {
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
        guard let entry = photoRetryQueue.enqueue(payload: payload, resultId: resultId, now: now) else {
            updateResultDeliveryState(id: resultId, state: .failed)
            statusText = "Could not queue photo"
            return
        }
        updateResultDeliveryState(id: resultId, state: ScanResult.DeliveryState(photoRetryStatus: entry.status))
        guard connectionStatus.isConnected else { return }
        await sendQueuedPhoto(photoId: payload.id)
    }

    func sendRetryablePhotos() async {
        photoRetryQueue.expireEntries()
        for entry in photoRetryQueue.retryableEntries {
            await sendQueuedPhoto(photoId: entry.id)
        }
    }

    func sendQueuedPhoto(photoId: String) async {
        guard connectionStatus.isConnected else { return }
        guard let resultId = photoRetryQueue.resultId(for: photoId),
              let payload = photoRetryQueue.payload(for: photoId)
        else { return }
        photoRetryQueue.markSending(photoId: photoId)
        updateResultDeliveryState(id: resultId, state: .sending)
        do {
            let receipt = try await connection.sendPhoto(payload)
            if case .received = receipt {
                photoRetryQueue.markReceived(photoId: photoId)
                updateResultDeliveryState(id: resultId, state: .sent)
                statusText = "Photo delivered"
            }
        } catch {
            photoRetryQueue.markFailed(photoId: photoId)
            updateResultDeliveryState(id: resultId, state: .failed)
            applyConnectionStatus(.error(error.localizedDescription))
        }
    }

    func applyPhotoTransferCompleted(photoId: String) {
        guard let resultId = photoRetryQueue.resultId(for: photoId) else { return }
        photoRetryQueue.markSent(photoId: photoId)
        updateResultDeliveryState(id: resultId, state: .sent)
        statusText = "Photo sent"
    }

    var initialDeliveryState: ScanResult.DeliveryState {
        connectionStatus.isConnected ? .sending : .saved
    }

    func updateResultDeliveryState(id: ScanResult.ID, state: ScanResult.DeliveryState) {
        guard let index = results.firstIndex(where: { $0.id == id }) else { return }
        results[index].deliveryState = state
    }

    func showCaptureDeliveryToast(for result: ScanResult, state: ScanResult.DeliveryState) {
        guard result.source == .capture else { return }

        switch state {
        case .sent:
            captureDeliveryToast = CaptureDeliveryToast(
                title: "Sent to Chrome",
                message: captureDeliveryMessage(for: result),
                systemImage: "checkmark.circle.fill",
                tone: .success
            )
        case .failed:
            captureDeliveryToast = CaptureDeliveryToast(
                title: "Send failed",
                message: captureDeliveryMessage(for: result),
                systemImage: "exclamationmark.triangle.fill",
                tone: .failure
            )
        case .saved, .sending:
            break
        }
    }

    func showCaptureTypingFallbackToast(for result: ScanResult) {
        guard result.source == .capture else { return }
        captureDeliveryToast = CaptureDeliveryToast(
            title: "Failed to type",
            message: "\(captureDeliveryMessage(for: result)) was saved to Chrome sidepanel results.",
            systemImage: "exclamationmark.triangle.fill",
            tone: .failure
        )
    }

    private func captureDeliveryMessage(for result: ScanResult) -> String {
        switch result.kind {
        case .barcode:
            "Barcode capture"
        case .text:
            "Document text"
        case .photo:
            "Photo capture"
        case .dictation:
            "Dictation"
        }
    }

    func currentPhotoBatch(now: Date) -> String {
        if let photoBatch, photoBatch.expiresAt > now {
            return photoBatch.id
        }
        let batch = ScannerProtocol.makeMessageId("batch")
        photoBatch = (batch, now.addingTimeInterval(5 * 60))
        return batch
    }

    func normalizedBarcodeFormat(_ format: String) -> String {
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

    func normalizedBarcodeScan(value: String, format: String) -> (value: String, format: String) {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedFormat = normalizedBarcodeFormat(format)
        if normalizedFormat == "ean13",
           trimmedValue.count == 13,
           trimmedValue.first == "0",
           trimmedValue.allSatisfy(\.isNumber) {
            return (String(trimmedValue.dropFirst()), "upc_a")
        }
        return (trimmedValue, normalizedFormat)
    }

    func uploadFilename(index: Int, capturedAt: Date) -> String {
        let uploadNumber = String(format: "%03d", index + 1)
        let timestampMs = Int(capturedAt.timeIntervalSince1970 * 1000)
        return "volt-upload-\(uploadNumber)-\(timestampMs).jpg"
    }
}


extension UIImage {
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
