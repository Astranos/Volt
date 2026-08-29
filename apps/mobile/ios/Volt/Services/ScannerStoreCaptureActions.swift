import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

private enum ProductScanCaptureError: LocalizedError {
    case emptyResult
    case invalidUPC

    var errorDescription: String? {
        switch self {
        case .emptyResult:
            "No product result was found. Try another photo."
        case .invalidUPC:
            "The returned UPC was not valid. Try another photo."
        }
    }
}

@MainActor
extension ScannerStore {
    func saveBarcodeIfNeeded() {
        guard let value = camera.lastBarcode, !value.isEmpty else { return }
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
            deliveryState: initialDeliveryState,
            batchId: currentCaptureBatchId()
        )
        guard saveResultLocally(result) else { return }
        sendCaptureResult(result, insertIntoCursor: true)
    }


    func capture() async {
        if isProductScannerActive {
            await captureProduct()
            return
        }

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

    func activateProductScanner() {
        activeMode = .photo
        isProductScannerActive = true
        productScanOutput = nil
        productScanError = nil
    }

    func deactivateProductScanner() {
        isProductScannerActive = false
        isProductScanBusy = false
        productScanOutput = nil
        productScanError = nil
    }

    func toggleProductScanMode() {
        productScanMode = productScanMode == .upc ? .name : .upc
        productScanOutput = nil
        productScanError = nil
    }

    func captureProduct() async {
        guard !isProductScanBusy else { return }
        let mode = productScanMode
        isProductScanBusy = true
        productScanOutput = nil
        productScanError = nil
        statusText = "Analyzing product…"
        defer { isProductScanBusy = false }

        guard let image = await camera.capturePhoto(matchingDeviceOrientation: true) else {
            productScanError = "Could not capture a product photo."
            statusText = productScanError ?? "Product scan failed"
            return
        }

        let preparedImage = image
            .normalizedForProcessing()
            .croppedToVisiblePreview(previewSize: camera.previewLayer.bounds.size)
        guard let imageData = preparedImage.boundedJPEGData(maxLongEdge: 1600, maxBytes: 1_500_000) else {
            productScanError = "The product photo could not be prepared."
            statusText = productScanError ?? "Product scan failed"
            return
        }

        do {
            let response = try await cloudWorkspace.analyzeProductImage(imageData, mode: mode)
            guard let responseValue = response.value else {
                throw ProductScanCaptureError.emptyResult
            }
            let value = responseValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { throw ProductScanCaptureError.emptyResult }

            let result: ScanResult
            switch mode {
            case .upc:
                let normalized = normalizedBarcodeScan(value: value, format: "upc_a")
                guard normalized.value.count == 12,
                      normalized.value.allSatisfy(\.isNumber)
                else { throw ProductScanCaptureError.invalidUPC }
                result = ScanResult(
                    kind: .barcode,
                    value: normalized.value,
                    format: "ai-upc/\(normalized.format)",
                    deliveryState: initialDeliveryState,
                    batchId: currentCaptureBatchId()
                )
            case .name:
                result = ScanResult(
                    kind: .text,
                    value: value,
                    format: "ai-item-name",
                    deliveryState: initialDeliveryState,
                    batchId: currentCaptureBatchId()
                )
            }

            guard saveResultLocally(result) else {
                productScanError = "The product result could not be saved on this iPhone."
                return
            }
            sendCaptureResult(result, insertIntoCursor: true)
            productScanOutput = ProductScanOutput(mode: mode, value: result.value)
            statusText = mode == .upc ? "UPC found" : "Product name found"
        } catch let error as MobileCloudError {
            productScanError = error.localizedDescription
            statusText = productScanError ?? "Product scan failed"
        } catch let error as ProductScanCaptureError {
            productScanError = error.localizedDescription
            statusText = productScanError ?? "Product scan failed"
        } catch {
            productScanError = "Product analysis failed. Try another photo."
            statusText = productScanError ?? "Product scan failed"
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
            let recognizedRegions = try await TextRecognizer.recognizeTextRegions(in: preparedImage)
            ocrTextRegions = DeviceIdentifierRegionExtractor.reviewRegions(from: recognizedRegions)
            ocrReviewText = ocrTextRegions.map(\.text).joined(separator: "\n")
            if ocrTextRegions.isEmpty {
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
        sendRecognizedText(text, format: "live-text")
    }

    func sendRecognizedText(_ text: String, format: String = "ocr-region") {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let result = ScanResult(
            kind: .text,
            value: text,
            format: format,
            deliveryState: initialDeliveryState,
            batchId: currentCaptureBatchId()
        )
        guard saveResultLocally(result) else { return }
        sendCaptureResult(result, insertIntoCursor: true)
        statusText = cloudWorkspace.selectedComputer == nil ? "Text saved" : "Text insertion queued"
    }

    func captureSquarePhoto() async {
        let batchId = currentCaptureBatchId()
        guard let image = await camera.capturePhoto(matchingDeviceOrientation: true) else { return }
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
        appendSessionPhotoThumbnail(preparedImage)
        await sendPhoto(preparedImage, result: photoResult, batchId: batchId)
    }

    /// Rebuilds the bottom-left strip when a photo session opens, so continuing a batch still shows
    /// the shots already in it.
    func startSessionPhotoStrip() {
        guard let resumedPhotoBatchId else {
            sessionPhotoThumbnails = []
            sessionPhotoCount = 0
            return
        }
        let batchPhotos = results
            .filter { $0.kind == .photo && $0.batchId == resumedPhotoBatchId }
            .sorted { $0.capturedAt > $1.capturedAt }
        sessionPhotoCount = batchPhotos.count
        sessionPhotoThumbnails = batchPhotos
            .prefix(Self.sessionPhotoStripLimit)
            .compactMap { result in
                result.imageData
                    .flatMap(UIImage.init(data:))
                    .map { SessionPhotoThumbnail(id: result.id, image: $0) }
            }
    }

    func appendSessionPhotoThumbnail(_ image: UIImage) {
        sessionPhotoCount += 1
        let thumbnail = SessionPhotoThumbnail(image: image.resized(maxLongEdge: 240))
        sessionPhotoThumbnails = Array(
            ([thumbnail] + sessionPhotoThumbnails).prefix(Self.sessionPhotoStripLimit)
        )
    }

    func uploadPhotos(_ images: [UIImage]) async {
        guard !images.isEmpty else { return }
        let now = Date.now
        let batch = "upload-batch-\(UUID().uuidString.lowercased())"
        photoUploadProgress = PhotoUploadProgress(
            id: batch,
            total: images.count,
            prepared: 0,
            completed: 0,
            failed: 0,
            phase: .preparing
        )
        statusText = "Preparing \(images.count) upload\(images.count == 1 ? "" : "s")"

        for (index, image) in images.enumerated() {
            let preparedImage = image
                .normalizedForProcessing()
                .resized(maxLongEdge: photoLongEdge)
            updatePhotoUploadProgress(batchId: batch, prepared: index + 1, phase: .uploading)
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
            statusText = "Uploading \(index + 1) of \(images.count)"
            await sendPhoto(
                preparedImage,
                result: photoResult,
                batchId: batch
            )
            finishPhotoUploadItem(batchId: batch, resultId: photoResult.id)
        }

        finishPhotoUploadBatch(batchId: batch)
        statusText = "Uploaded \(images.count) photo\(images.count == 1 ? "" : "s")"
    }

    func capturePhoto() async {
        await capture()
    }

    func removeResult(id: ScanResult.ID) {
        cloudWorkspace.remove(resultId: id)
        results.removeAll { $0.id == id }
    }

    func insertResultIntoComputer(id: ScanResult.ID) async {
        guard let result = results.first(where: { $0.id == id }) else { return }

        switch result.kind {
        case .barcode, .text, .dictation:
            guard cloudWorkspace.selectedComputer != nil else {
                updateResultDeliveryState(id: id, state: .saved)
                statusText = "Choose an online computer before inserting."
                return
            }
            await queueCursorInsertion(
                result,
                deliveryId: "del-\(UUID().uuidString.lowercased())"
            )
        case .photo:
            cloudWorkspace.requestSync()
            updateResultDeliveryState(id: id, state: .saved)
            statusText = "Photo sync requested"
        }
    }


    func removeResults(at offsets: IndexSet) {
        results.remove(atOffsets: offsets)
    }

    func sendCaptureResult(_ result: ScanResult, insertIntoCursor: Bool) {
        guard insertIntoCursor, cloudWorkspace.selectedComputer != nil else { return }
        Task {
            await queueCursorInsertion(
                result,
                deliveryId: "del-\(result.id.uuidString.lowercased())"
            )
        }
    }

    private func queueCursorInsertion(_ result: ScanResult, deliveryId: String) async {
        updateResultDeliveryState(id: result.id, state: .sending)
        let queued = await cloudWorkspace.queueCursorDelivery(
            result: result,
            deliveryId: deliveryId
        )
        switch queued {
        case true:
            cloudWorkspace.trackCursorDelivery(deliveryId: deliveryId, resultId: result.id)
            statusText = result.kind == .barcode ? "Barcode insertion pending" : "Text insertion pending"
            targetHint = cloudWorkspace.selectedComputer.map { "Queued for \($0.label)." } ?? "Insertion queued."
        case false:
            updateResultDeliveryState(id: result.id, state: .failed)
            statusText = "Capture saved; insertion failed"
            playCaptureFailureFeedback()
            showCaptureDeliveryToast(for: result, state: .failed)
        case nil:
            updateResultDeliveryState(id: result.id, state: .saved)
        }
    }


    func sendPhoto(
        _ image: UIImage,
        result: ScanResult,
        batchId: String? = nil
    ) async {
        guard let data = image.jpegData(compressionQuality: 0.76) else {
            statusText = "Could not prepare photo"
            updateResultDeliveryState(id: result.id, state: .failed)
            return
        }
        let batch = batchId ?? currentPhotoBatch(now: .now)
        do {
            var cloudResult = result
            cloudResult.batchId = batch
            try cloudWorkspace.persist(cloudResult, photoData: data)
            results.insert(cloudResult, at: 0)
            statusText = "Photo saved"
        } catch {
            statusText = "Could not save photo on this device"
        }
    }

    var initialDeliveryState: ScanResult.DeliveryState {
        .saved
    }

    @discardableResult
    func saveResultLocally(_ result: ScanResult) -> Bool {
        do {
            try cloudWorkspace.persist(result)
            results.insert(result, at: 0)
            return true
        } catch {
            var failedResult = result
            failedResult.deliveryState = .failed
            results.insert(failedResult, at: 0)
            statusText = "Could not save capture on this device"
            return false
        }
    }

    func updateResultDeliveryState(id: ScanResult.ID, state: ScanResult.DeliveryState) {
        guard let index = results.firstIndex(where: { $0.id == id }) else { return }
        results[index].deliveryState = state
    }

    func applyDeliveryResolution(_ resolution: CursorDeliveryResolution) {
        guard let result = results.first(where: { $0.id == resolution.resultId }),
              result.deliveryState == .sending
        else { return }
        updateResultDeliveryState(id: resolution.resultId, state: resolution.state)
        switch resolution.state {
        case .sent:
            statusText = "Computer insertion complete"
        case .failed:
            statusText = cursorDeliveryFailureMessage(for: resolution.errorCode)
            playCaptureFailureFeedback()
            showCaptureDeliveryToast(for: result, state: .failed)
        case .saved, .sending:
            break
        }
    }

    func cursorDeliveryFailureMessage(for errorCode: String?) -> String {
        switch errorCode {
        case "expired": "Insertion expired before a computer accepted it"
        case "no-editable-field": "No editable field was focused on the computer"
        case "target-rebound": "The selected computer switched to another account"
        default: "Computer insertion failed"
        }
    }

    func updatePhotoUploadProgress(batchId: String, prepared: Int, phase: PhotoUploadProgress.Phase) {
        guard var progress = photoUploadProgress, progress.id == batchId else { return }
        progress.prepared = min(progress.total, max(progress.prepared, prepared))
        progress.phase = phase
        photoUploadProgress = progress
    }

    func finishPhotoUploadItem(batchId: String, resultId: ScanResult.ID) {
        guard var progress = photoUploadProgress, progress.id == batchId else { return }
        let resultState = results.first(where: { $0.id == resultId })?.deliveryState
        if resultState == .failed {
            progress.failed += 1
        } else {
            progress.completed += 1
        }
        progress.completed = min(progress.completed, progress.total)
        progress.failed = min(progress.failed, progress.total - progress.completed)
        photoUploadProgress = progress
    }

    func finishPhotoUploadBatch(batchId: String) {
        guard var progress = photoUploadProgress, progress.id == batchId else { return }
        progress.phase = .finished
        photoUploadProgress = progress
    }

    func showCaptureDeliveryToast(for result: ScanResult, state: ScanResult.DeliveryState) {
        guard result.source == .capture else { return }

        switch state {
        case .sent:
            captureDeliveryToast = CaptureDeliveryToast(
                title: "Saved to Volt",
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

    func resumePhotoBatch(id: String) {
        resumeCaptureSession(batchId: id)
    }

    func endResumedPhotoBatch() {
        endCaptureSession()
    }

    func currentPhotoBatch(now: Date) -> String {
        if let activeCaptureBatchId {
            return activeCaptureBatchId
        }
        if let capturePhotoBatch, capturePhotoBatch.expiresAt > now {
            return capturePhotoBatch.id
        }
        let batch = "batch-\(UUID().uuidString.lowercased())"
        capturePhotoBatch = (batch, now.addingTimeInterval(5 * 60))
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

}


extension UIImage {
    var sizeDescription: String {
    "\(Int(size.width)) x \(Int(size.height))"
    }

    func previewJPEGData() -> Data? {
    resized(maxLongEdge: 640).jpegData(compressionQuality: 0.72)
    }

    func boundedJPEGData(maxLongEdge: CGFloat, maxBytes: Int) -> Data? {
        let preparedImage = resized(maxLongEdge: maxLongEdge)
        for quality in stride(from: 0.82, through: 0.42, by: -0.08) {
            guard let data = preparedImage.jpegData(compressionQuality: quality) else { continue }
            if data.count <= maxBytes { return data }
        }
        return nil
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
    colorControls.saturation = 0.92
    colorControls.contrast = 1.18
    colorControls.brightness = 0.02

    let sharpen = CIFilter.sharpenLuminance()
    sharpen.inputImage = colorControls.outputImage
    sharpen.sharpness = 0.42

    guard
        let output = sharpen.outputImage,
        let cgImage = CIContext(options: [.useSoftwareRenderer: false]).createCGImage(output, from: output.extent)
    else {
        return self
    }

    return UIImage(cgImage: cgImage, scale: scale, orientation: .up)
    }
}
