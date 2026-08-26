import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class ClipScannerStore {
    static let sessionPhotoStripLimit = 3

    enum ClipTab: String, CaseIterable, Identifiable {
        case text
        case barcode
        case photos

        var id: String { rawValue }

        var title: String {
            switch self {
            case .text: "Text"
            case .barcode: "Barcode"
            case .photos: "Photos"
            }
        }

        var systemImage: String {
            switch self {
            case .text: "doc.text.viewfinder"
            case .barcode: "barcode.viewfinder"
            case .photos: "camera.viewfinder"
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

    var selectedTab: ClipTab = .text
    var activeCaptureMode: CaptureMode = .ocr
    var pairingURLText = ""
    var statusText = "Scan the workspace QR from Volt in Chrome."
    var targetHint = "Not connected"
    var pairingLabel: String?
    var pairingFailureMessage: String?
    var isPairing = false
    var isConnected = false
    var isRecognizingText = false
    var photos: [ClipPhoto] = []
    var captures: [ClipCapture] = []
    var workspaceComputers: [AppClipWorkspaceComputer] = []
    var selectedWorkspaceComputerId: String?
    var isLoadingWorkspaceComputers = false
    var workspaceComputerError: String?
    var photoUploadProgress: PhotoUploadProgress?
    var ocrReviewImage: UIImage?
    var ocrTextRegions: [RecognizedTextRegion] = []
    var ocrReviewText = ""
    var errorMessage: String?

    @ObservationIgnored private let ocrService = ClipOCRService()
    @ObservationIgnored private let guestCloudClient = AppClipGuestCloudClient()
    @ObservationIgnored private let pairingImpactFeedback = UIImpactFeedbackGenerator(style: .medium)
    @ObservationIgnored private let pairingNotificationFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored private let captureSuccessFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored private let captureFailureFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored private let captureFailureImpactFeedback = UIImpactFeedbackGenerator(style: .heavy)
    private var pairingSession: PairingSession?
    private var guestCloudSession: AppClipGuestCloudSession?
    private var activeConnectionAttemptLabel: String?
    private var activeCaptureBatchId: String?

    var canRetryPairing: Bool { pairingSession != nil && !isPairing && !isConnected }
    var canRetryConnection: Bool { canRetryPairing }
    var canReconnectToLastSession: Bool { false }
    var lastSessionDisplayName: String? { nil }

    var connectionAttemptDisplayName: String {
        activeConnectionAttemptLabel ?? pairingLabel ?? "Volt workspace"
    }

    var availableWorkspaceComputers: [AppClipWorkspaceComputer] {
        workspaceComputers
            .filter { $0.online && $0.supportsCursorInsertion }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }

    var unavailableWorkspaceComputers: [AppClipWorkspaceComputer] {
        workspaceComputers
            .filter { !$0.online && $0.supportsCursorInsertion }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }

    var selectedWorkspaceComputer: AppClipWorkspaceComputer? {
        guard let selectedWorkspaceComputerId else { return nil }
        return availableWorkspaceComputers.first { $0.deviceId == selectedWorkspaceComputerId }
    }

    var typingTargetLabel: String {
        selectedWorkspaceComputer?.label ?? "Choose a computer"
    }

    var canChooseWorkspaceComputer: Bool { isConnected }

    func handleIncomingURL(_ url: URL) {
        let (session, mode) = PairingURLParser.parse(url)
        if let mode { selectMode(mode) }
        guard let session else { return }
        preparePairing(session: session, url: url)
        Task { await pair(session) }
    }

    func pairFromText() {
        guard let url = PairingURLParser.pairingURL(in: pairingURLText) ?? URL(string: pairingURLText) else {
            errorMessage = "Paste a Volt workspace URL from Chrome."
            return
        }
        handleIncomingURL(url)
    }

    func pair(_ session: PairingSession? = nil) async {
        let nextSession = session ?? pairingSession
        guard let nextSession,
              let cloudSession = AppClipGuestCloudSession(pairingSession: nextSession)
        else {
            pairingFailureMessage = "This QR does not contain a valid workspace grant."
            errorMessage = pairingFailureMessage
            return
        }

        isPairing = true
        isConnected = false
        errorMessage = nil
        pairingFailureMessage = nil
        statusText = "Connecting to workspace"
        pairingImpactFeedback.impactOccurred(intensity: 0.8)
        do {
            let computers = try await guestCloudClient.listComputers(session: cloudSession)
            guestCloudSession = cloudSession
            workspaceComputers = computers
            selectInitialComputer()
            isPairing = false
            isConnected = true
            activeConnectionAttemptLabel = nil
            statusText = "Connected to workspace"
            targetHint = typingTargetLabel
            pairingNotificationFeedback.notificationOccurred(.success)
            sendSavedItemsAfterConnect()
        } catch {
            isPairing = false
            guestCloudSession = nil
            let message = "Could not open this workspace. Create a new QR in Chrome and try again."
            pairingFailureMessage = message
            errorMessage = message
            statusText = "Connection failed"
            targetHint = "Scan a fresh Volt QR code"
            pairingNotificationFeedback.notificationOccurred(.error)
        }
    }

    func retryPairing() {
        guard canRetryPairing else { return }
        Task { await pair() }
    }

    func retryFailedConnection() {
        retryPairing()
    }

    func reconnectToLastSession() {
        retryPairing()
    }

    func cancelConnectionAttempt() {
        guard isPairing else { return }
        isPairing = false
        statusText = "Connection canceled"
        targetHint = "Scan a workspace QR"
    }

    func refreshWorkspaceComputers() async {
        guard let guestCloudSession, !guestCloudSession.isExpired else {
            workspaceComputers = []
            selectedWorkspaceComputerId = nil
            workspaceComputerError = nil
            return
        }
        isLoadingWorkspaceComputers = true
        defer { isLoadingWorkspaceComputers = false }
        do {
            workspaceComputers = try await guestCloudClient.listComputers(session: guestCloudSession)
            if selectedWorkspaceComputer == nil { selectInitialComputer() }
            workspaceComputerError = nil
        } catch {
            workspaceComputerError = "Could not refresh workspace computers."
        }
    }

    func selectWorkspaceComputer(deviceId: String?) {
        if let deviceId,
           !availableWorkspaceComputers.contains(where: { $0.deviceId == deviceId }) {
            return
        }
        selectedWorkspaceComputerId = deviceId
        targetHint = typingTargetLabel
    }

    func pairFromScannedValue(_ value: String) -> Bool {
        guard !isPairing else { return true }
        return handlePairingValue(value, invalidMessage: "That QR is not a Volt workspace QR.")
    }

    @discardableResult
    func addCapturedImage(
        _ image: UIImage,
        source: ClipPhoto.Source,
        batchId: String? = nil,
        capturedAt: Date = .now
    ) -> ClipPhoto {
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

    @discardableResult
    func beginCaptureSession() -> String {
        let batchId = Self.makeMessageId("batch")
        activeCaptureBatchId = batchId
        return batchId
    }

    @discardableResult
    func resumeCaptureSession(batchId: String) -> String {
        activeCaptureBatchId = batchId
        return batchId
    }

    func endCaptureSession(id: String? = nil) {
        if let id, activeCaptureBatchId != id { return }
        activeCaptureBatchId = nil
    }

    private func prepareCapturedPhoto(_ image: UIImage) -> UIImage {
        image
            .normalizedForProcessing()
            .centerSquareCropped()
            .resized(maxLongEdge: 2200)
    }

    func capturePhoto(_ image: UIImage, batchId: String? = nil) async {
        let preparedImage = prepareCapturedPhoto(image)
        let photo = addCapturedImage(
            preparedImage,
            source: .capture,
            batchId: batchId ?? currentCaptureBatchId()
        )
        await sendPhoto(photo)
    }

    func uploadPhotos(_ images: [UIImage]) async {
        guard !images.isEmpty else { return }
        guard isConnected else {
            statusText = "Connect to a workspace before uploading."
            targetHint = "Connect to workspace first"
            return
        }
        let now = Date.now
        let batchId = Self.makeMessageId("upload-batch")
        photoUploadProgress = PhotoUploadProgress(
            id: batchId,
            total: images.count,
            prepared: 0,
            completed: 0,
            failed: 0,
            phase: .preparing
        )
        statusText = "Preparing \(images.count) upload\(images.count == 1 ? "" : "s")"
        for (index, image) in images.enumerated() {
            let capturedAt = now.addingTimeInterval(Double(index) / 1000)
            let preparedImage = image.normalizedForProcessing().resized(maxLongEdge: 2200)
            updatePhotoUploadProgress(batchId: batchId, prepared: index + 1, phase: .uploading)
            let photo = addCapturedImage(preparedImage, source: .upload, batchId: batchId, capturedAt: capturedAt)
            statusText = "Uploading \(index + 1) of \(images.count)"
            let didSend = await sendPhoto(photo, filename: uploadFilename(index: index, capturedAt: capturedAt))
            finishPhotoUploadItem(batchId: batchId, succeeded: didSend)
        }
        finishPhotoUploadBatch(batchId: batchId)
        let failedCount = photoUploadProgress?.failed ?? 0
        let completedCount = photoUploadProgress?.completed ?? max(0, images.count - failedCount)
        if failedCount == 0 {
            statusText = "Uploaded \(images.count) photo\(images.count == 1 ? "" : "s")"
        } else if completedCount == 0 {
            statusText = "Upload failed for \(failedCount) photo\(failedCount == 1 ? "" : "s")"
        } else {
            statusText = "Uploaded \(completedCount) of \(images.count) photos, \(failedCount) failed"
        }
    }

    @discardableResult
    func sendPhoto(_ photo: ClipPhoto, filename: String? = nil) async -> Bool {
        guard let session = guestCloudSession,
              let data = photo.image.jpegData(compressionQuality: 0.82)
        else {
            errorMessage = "Connect to a workspace first."
            updatePhoto(photo.id, status: "Saved until connected")
            return false
        }
        updatePhoto(photo.id, status: "Sending")
        do {
            try await guestCloudClient.mirrorPhoto(
                session: session,
                data: data,
                filename: filename ?? photoFilename(for: photo),
                capturedAt: photo.capturedAt
            )
            updatePhoto(photo.id, status: "Delivered")
            statusText = "Photo uploaded to workspace"
            captureSuccessFeedback.notificationOccurred(.success)
            return true
        } catch {
            updatePhoto(photo.id, status: "Failed")
            errorMessage = error.localizedDescription
            statusText = "Photo upload failed"
            playCaptureFailureFeedback()
            return false
        }
    }

    func handleBarcodeScan(_ scan: ClipBarcodeScan) {
        if scan.isQRCode, handlePairingValue(scan.value, invalidMessage: nil) { return }
        guard activeCaptureMode == .barcode else { return }
        let normalized = normalizedBarcodeScan(value: scan.value, format: scan.format)
        sendCapture(mode: .barcode, value: normalized.value, format: normalized.format, capturedAt: scan.capturedAt)
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
        if handlePairingValue(trimmed, invalidMessage: nil) { return }
        sendCapture(mode: .ocr, value: trimmed, format: format, capturedAt: .now)
    }

    func selectMode(_ mode: CaptureMode) {
        activeCaptureMode = mode
        selectedTab = tab(for: mode)
    }

    func disconnect() {
        guestCloudSession = nil
        pairingSession = nil
        workspaceComputers = []
        selectedWorkspaceComputerId = nil
        isConnected = false
        isPairing = false
        statusText = "Disconnected"
        targetHint = "Disconnected"
    }

    func removePhoto(id: UUID) {
        photos.removeAll { $0.id == id }
    }

    func removePhotos(batchId: String) {
        photos.removeAll { ($0.batchId ?? $0.id.uuidString) == batchId }
    }

    private func preparePairing(session: PairingSession, url: URL) {
        pairingSession = session
        pairingURLText = url.absoluteString
        pairingLabel = session.label
        activeConnectionAttemptLabel = displayName(for: session)
        pairingFailureMessage = nil
    }

    private func selectInitialComputer() {
        if selectedWorkspaceComputer != nil { return }
        let preferredLabel = pairingLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
        selectedWorkspaceComputerId = availableWorkspaceComputers.first(where: {
            guard let preferredLabel, !preferredLabel.isEmpty else { return false }
            return $0.label.compare(preferredLabel, options: .caseInsensitive) == .orderedSame
        })?.deviceId ?? availableWorkspaceComputers.first?.deviceId
    }

    private func sendCapture(
        mode: CaptureMode,
        value: String,
        format: String,
        capturedAt: Date
    ) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let capture = ClipCapture(
            mode: mode,
            value: trimmed,
            format: format,
            capturedAt: capturedAt,
            status: isConnected ? "Sending" : "Saved until connected"
        )
        captures.insert(capture, at: 0)
        guard isConnected else {
            statusText = mode == .barcode ? "Barcode saved" : "Text saved"
            return
        }
        sendCaptureToWorkspace(capture)
    }

    private func sendSavedItemsAfterConnect() {
        for capture in captures where capture.status == "Saved until connected" {
            sendCaptureToWorkspace(capture)
        }
        let savedPhotos = photos.filter { $0.status == "Saved until connected" }
        Task {
            for photo in savedPhotos { await sendPhoto(photo) }
        }
    }

    private func sendCaptureToWorkspace(_ capture: ClipCapture) {
        guard let session = guestCloudSession else { return }
        let target = selectedWorkspaceComputer
        updateCapture(capture.id, status: "Sending")
        Task {
            do {
                try await guestCloudClient.mirrorCapture(
                    session: session,
                    kind: capture.mode == .barcode ? "barcode" : "text",
                    value: capture.value,
                    format: capture.format,
                    capturedAt: capture.capturedAt,
                    resultId: "appclip-result-\(capture.id.uuidString.lowercased())",
                    targetDeviceId: target?.deviceId
                )
                updateCapture(capture.id, status: target == nil ? "Saved" : "Queued")
                statusText = target.map { "Queued for \($0.label)" } ?? "Saved to workspace"
                targetHint = typingTargetLabel
                captureSuccessFeedback.notificationOccurred(.success)
            } catch {
                updateCapture(capture.id, status: "Failed")
                errorMessage = error.localizedDescription
                statusText = "Send failed"
                playCaptureFailureFeedback()
            }
        }
    }

    private func updatePhoto(_ id: UUID, status: String) {
        guard let index = photos.firstIndex(where: { $0.id == id }) else { return }
        photos[index].status = status
    }

    private func updatePhotoUploadProgress(
        batchId: String,
        prepared: Int? = nil,
        phase: PhotoUploadProgress.Phase? = nil
    ) {
        guard photoUploadProgress?.id == batchId else { return }
        if let prepared { photoUploadProgress?.prepared = prepared }
        if let phase { photoUploadProgress?.phase = phase }
    }

    private func finishPhotoUploadItem(batchId: String, succeeded: Bool) {
        guard photoUploadProgress?.id == batchId else { return }
        if succeeded { photoUploadProgress?.completed += 1 } else { photoUploadProgress?.failed += 1 }
        photoUploadProgress?.phase = .uploading
    }

    private func finishPhotoUploadBatch(batchId: String) {
        guard photoUploadProgress?.id == batchId else { return }
        photoUploadProgress?.phase = .finished
    }

    @discardableResult
    private func handlePairingValue(_ value: String, invalidMessage: String?) -> Bool {
        guard let url = PairingURLParser.pairingURL(in: value) ?? URL(string: value) else {
            if let invalidMessage { errorMessage = invalidMessage }
            return false
        }
        let (session, mode) = PairingURLParser.parse(url)
        guard let session else {
            if let invalidMessage { errorMessage = invalidMessage }
            return false
        }
        if let mode { selectMode(mode) }
        preparePairing(session: session, url: url)
        Task { await pair(session) }
        return true
    }

    private func displayName(for session: PairingSession) -> String {
        let label = session.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return label.isEmpty ? "Volt workspace" : label
    }

    private func updateCapture(_ id: UUID, status: String) {
        guard let index = captures.firstIndex(where: { $0.id == id }) else { return }
        captures[index].status = status
    }

    private func playCaptureFailureFeedback() {
        captureFailureImpactFeedback.impactOccurred(intensity: 1)
        captureFailureFeedback.notificationOccurred(.error)
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
        case .capture: "volt-clip-photo-\(Int(photo.capturedAt.timeIntervalSince1970 * 1000)).jpg"
        case .upload: "volt-upload-\(Int(photo.capturedAt.timeIntervalSince1970 * 1000)).jpg"
        }
    }

    private func uploadFilename(index: Int, capturedAt: Date) -> String {
        let uploadNumber = String(format: "%03d", index + 1)
        return "volt-upload-\(uploadNumber)-\(Int(capturedAt.timeIntervalSince1970 * 1000)).jpg"
    }

    private func currentCaptureBatchId() -> String {
        if let activeCaptureBatchId { return activeCaptureBatchId }
        let batchId = Self.makeMessageId("batch")
        activeCaptureBatchId = batchId
        return batchId
    }

    private static func makeMessageId(_ prefix: String) -> String {
        "\(prefix)-\(UUID().uuidString.lowercased())"
    }

    private func tab(for mode: CaptureMode) -> ClipTab {
        switch mode {
        case .dictation, .ocr: .text
        case .photo: .photos
        case .barcode: .barcode
        }
    }
}

private extension UIImage {
    func normalizedForProcessing() -> UIImage {
        guard imageOrientation != .up else { return self }
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { _ in draw(in: CGRect(origin: .zero, size: size)) }
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
        return renderer.image { _ in draw(in: CGRect(origin: .zero, size: targetSize)) }
    }
}
