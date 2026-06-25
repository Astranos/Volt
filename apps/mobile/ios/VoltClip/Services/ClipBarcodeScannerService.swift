@preconcurrency import AVFoundation
import CoreMedia
import Foundation
import UIKit
@preconcurrency import Vision

struct ClipBarcodeScan: Equatable, Identifiable {
    let id = UUID()
    let value: String
    let format: String
    let bounds: CGRect
    let capturedAt: Date

    var isQRCode: Bool {
        format.lowercased().contains("qr")
    }
}

@MainActor
final class ClipBarcodeScannerService: NSObject {
    static let supportedMetadataObjectTypes: [AVMetadataObject.ObjectType] = [
        .aztec,
        .code128,
        .code39,
        .code39Mod43,
        .code93,
        .dataMatrix,
        .ean13,
        .ean8,
        .interleaved2of5,
        .itf14,
        .pdf417,
        .qr,
        .upce,
    ]
    static let captureMetadataObjectTypes: [AVMetadataObject.ObjectType] = [
        .ean13,
        .ean8,
        .upce,
    ]

    let session = AVCaptureSession()
    let previewLayer = AVCaptureVideoPreviewLayer()
    var onScan: ((ClipBarcodeScan) -> Void)?
    var onDetectedBarcode: ((CGRect?, String?) -> Void)?
    var onLiveTextCandidates: (([LiveTextCandidate]) -> Void)?
    var onError: ((String) -> Void)?
    private(set) var latestScan: ClipBarcodeScan?
    private(set) var detectedBarcodeBounds: CGRect?
    private(set) var detectedBarcodeFormat: String?
    private(set) var liveTextCandidates: [LiveTextCandidate] = []
    private(set) var torchEnabled = false
    private(set) var zoomDisplayLabel = "1x"
    var onCameraStateChanged: (() -> Void)?

    private let metadataOutput = AVCaptureMetadataOutput()
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let liveTextFrameProcessor = ClipLiveTextFrameProcessor()
    private let sessionQueue = DispatchQueue(label: "com.volt.clip.barcode-session")
    private let metadataQueue = DispatchQueue(label: "com.volt.clip.barcode-metadata")
    private let videoQueue = DispatchQueue(label: "com.volt.clip.video-text")
    private var isConfigured = false
    private var lastEmittedValue: String?
    private var lastEmittedAt: Date?
    private var photoCaptureDelegates: [ClipPhotoCaptureDelegate] = []
    private var barcodeClearTask: Task<Void, Never>?
    private var barcodeDetectionRevision = 0
    private var liveTextReplacementObservationCounts: [String: Int] = [:]
    private var videoDevice: AVCaptureDevice?
    private var displayZoomFactor: CGFloat = 1

    override init() {
        super.init()
        previewLayer.session = session
        previewLayer.videoGravity = .resizeAspectFill
        liveTextFrameProcessor.onCandidates = { [weak self] candidates in
            Task { @MainActor in
                self?.applyLiveTextCandidates(candidates)
            }
        }
    }

    func requestAccessAndStart() async {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
        }
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            onError?("Camera access is required to scan barcodes.")
            return
        }
        await startRunningIfNeeded(resetZoom: true)
    }

    func start() {
        configureIfNeeded()
        let session = session
        let videoDevice = videoDevice
        sessionQueue.async {
            if let videoDevice {
                self.resetZoomToDisplayOne(for: videoDevice)
            }
            guard !session.isRunning else { return }
            session.startRunning()
        }
    }

    func stop() {
        clearDetectedBarcode()
        setLiveTextScanningEnabled(false)
        setTorchEnabled(false)
        let session = session
        sessionQueue.async {
            guard session.isRunning else { return }
            session.stopRunning()
        }
    }

    func setLiveTextScanningEnabled(_ enabled: Bool) {
        liveTextFrameProcessor.isEnabled = enabled
        if !enabled {
            clearLiveTextCandidates()
        }
    }

    func clearLiveTextCandidates() {
        liveTextFrameProcessor.reset()
        liveTextCandidates = []
        liveTextReplacementObservationCounts = [:]
        onLiveTextCandidates?([])
    }

    func clearDetectedBarcode() {
        barcodeDetectionRevision += 1
        barcodeClearTask?.cancel()
        barcodeClearTask = nil
        latestScan = nil
        detectedBarcodeBounds = nil
        detectedBarcodeFormat = nil
        onDetectedBarcode?(nil, nil)
    }

    func setTorchEnabled(_ enabled: Bool) {
        guard let videoDevice, videoDevice.hasTorch else {
            torchEnabled = false
            onCameraStateChanged?()
            return
        }
        sessionQueue.async { [weak self] in
            do {
                try videoDevice.lockForConfiguration()
                if enabled {
                    try videoDevice.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
                } else {
                    videoDevice.torchMode = .off
                }
                videoDevice.unlockForConfiguration()
                Task { @MainActor in
                    self?.torchEnabled = videoDevice.torchMode == .on
                    self?.onCameraStateChanged?()
                }
            } catch {
                Task { @MainActor in
                    self?.onError?(error.localizedDescription)
                }
            }
        }
    }

    func adjustZoom(by delta: CGFloat) {
        guard let videoDevice else { return }
        setZoomFactor((displayZoomFactor + delta) / displayZoomFactorMultiplier(for: videoDevice))
    }

    func scaleZoom(by scale: CGFloat) {
        guard let videoDevice else { return }
        sessionQueue.async { [weak self] in
            do {
                let clampedFactor = self?.clampedRawZoomFactor(
                    videoDevice.videoZoomFactor * scale,
                    for: videoDevice
                ) ?? videoDevice.videoZoomFactor
                let zoomState = try CameraZoomController.setRawZoomFactor(clampedFactor, on: videoDevice)
                Task { @MainActor in
                    self?.applyZoomState(zoomState)
                }
            } catch {
                Task { @MainActor in
                    self?.onError?(error.localizedDescription)
                }
            }
        }
    }

    func focus(at point: CGPoint) {
        guard let videoDevice else { return }
        sessionQueue.async { [weak self] in
            do {
                try videoDevice.lockForConfiguration()
                defer { videoDevice.unlockForConfiguration() }
                if videoDevice.isFocusPointOfInterestSupported {
                    videoDevice.focusPointOfInterest = point
                    if videoDevice.isFocusModeSupported(.autoFocus) {
                        videoDevice.focusMode = .autoFocus
                    } else if videoDevice.isFocusModeSupported(.continuousAutoFocus) {
                        videoDevice.focusMode = .continuousAutoFocus
                    }
                }
                if videoDevice.isExposurePointOfInterestSupported {
                    videoDevice.exposurePointOfInterest = point
                    if videoDevice.isExposureModeSupported(.autoExpose) {
                        videoDevice.exposureMode = .autoExpose
                    } else if videoDevice.isExposureModeSupported(.continuousAutoExposure) {
                        videoDevice.exposureMode = .continuousAutoExposure
                    }
                }
            } catch {
                Task { @MainActor in
                    self?.onError?(error.localizedDescription)
                }
            }
        }
    }

    func capturePhoto() async throws -> UIImage {
        configureIfNeeded()
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            throw ClipCameraCaptureError.cameraAccessDenied
        }
        guard session.outputs.contains(where: { $0 === photoOutput }) else {
            throw ClipCameraCaptureError.photoCaptureUnavailable
        }
        await startRunningIfNeeded()

        return try await withCheckedThrowingContinuation { continuation in
            let settings: AVCapturePhotoSettings
            if photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
                settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            } else {
                settings = AVCapturePhotoSettings()
            }

            let delegate = ClipPhotoCaptureDelegate()
            delegate.onFinish = { [weak self, weak delegate] result in
                Task { @MainActor in
                    if let delegate {
                        self?.photoCaptureDelegates.removeAll { $0 === delegate }
                    }
                    continuation.resume(with: result)
                }
            }
            photoCaptureDelegates.append(delegate)
            photoOutput.capturePhoto(with: settings, delegate: delegate)
        }
    }

    private func startRunningIfNeeded(resetZoom: Bool = false) async {
        configureIfNeeded()
        let session = session
        let videoDevice = videoDevice
        await withCheckedContinuation { continuation in
            sessionQueue.async {
                if resetZoom, let videoDevice {
                    self.resetZoomToDisplayOne(for: videoDevice)
                }
                if !session.isRunning {
                    session.startRunning()
                }
                continuation.resume()
            }
        }
    }

    private func configureIfNeeded() {
        guard !isConfigured else { return }
        isConfigured = true

        session.beginConfiguration()
        session.sessionPreset = .high

        guard
            let camera = CameraDeviceSelector.bestBackCamera() ?? AVCaptureDevice.default(for: .video),
            let input = try? AVCaptureDeviceInput(device: camera),
            session.canAddInput(input)
        else {
            session.commitConfiguration()
            onError?("Camera is not available.")
            return
        }

        videoDevice = camera
        updateZoomState(for: camera, rawZoomFactor: camera.videoZoomFactor)

        session.addInput(input)
        if session.canAddOutput(metadataOutput) {
            session.addOutput(metadataOutput)
            metadataOutput.setMetadataObjectsDelegate(self, queue: metadataQueue)
            let availableTypes = metadataOutput.availableMetadataObjectTypes
            metadataOutput.metadataObjectTypes = Self.captureMetadataObjectTypes.filter {
                availableTypes.contains($0)
            }
        }
        if session.canAddOutput(photoOutput) {
            session.addOutput(photoOutput)
        }
        if session.canAddOutput(videoOutput) {
            session.addOutput(videoOutput)
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
            ]
            videoOutput.setSampleBufferDelegate(liveTextFrameProcessor, queue: videoQueue)
        }

        session.commitConfiguration()
    }

    private func emitBestScan(from objects: [AVMetadataMachineReadableCodeObject]) {
        guard let candidate = bestCandidate(from: objects) else {
            clearDetectedBarcode()
            return
        }
        let now = Date.now
        detectedBarcodeBounds = candidate.bounds
        detectedBarcodeFormat = normalizedFormat(candidate.object.type.rawValue)
        onDetectedBarcode?(candidate.bounds, detectedBarcodeFormat)
        scheduleStaleBarcodeClear()

        if candidate.value == lastEmittedValue,
           let lastEmittedAt,
           now.timeIntervalSince(lastEmittedAt) < 1.25 {
            return
        }

        lastEmittedValue = candidate.value
        lastEmittedAt = now
        let scan = ClipBarcodeScan(
            value: candidate.value,
            format: normalizedFormat(candidate.object.type.rawValue),
            bounds: candidate.bounds,
            capturedAt: now
        )
        latestScan = scan
        onScan?(scan)
    }

    private func scheduleStaleBarcodeClear() {
        barcodeDetectionRevision += 1
        let revision = barcodeDetectionRevision
        barcodeClearTask?.cancel()
        barcodeClearTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(450))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let self, self.barcodeDetectionRevision == revision else { return }
                self.clearDetectedBarcode()
            }
        }
    }

    private func applyLiveTextCandidates(_ candidates: [LiveTextCandidateObservation]) {
        guard !candidates.isEmpty else {
            liveTextCandidates = []
            liveTextReplacementObservationCounts = [:]
            onLiveTextCandidates?([])
            return
        }
        var acceptedCandidates = liveTextCandidates
        for candidate in candidates {
            guard !hasLiveTextCandidate(candidate, in: acceptedCandidates) else { continue }
            let liveCandidate = liveTextCandidate(from: candidate)
            if let replacementIndex = replacementIndex(for: candidate, in: acceptedCandidates) {
                if shouldReplaceLiveTextCandidate(candidate, replacing: acceptedCandidates[replacementIndex]) {
                    acceptedCandidates[replacementIndex] = liveCandidate
                }
            } else if canAppendLiveTextCandidate(candidate, to: acceptedCandidates) {
                acceptedCandidates.append(liveCandidate)
            }
        }
        liveTextCandidates = acceptedCandidates
        onLiveTextCandidates?(acceptedCandidates)
    }

    private func liveTextCandidate(from candidate: LiveTextCandidateObservation) -> LiveTextCandidate {
        LiveTextCandidate(
            kind: candidate.kind,
            value: candidate.value,
            bounds: previewRect(forVisionBoundingBox: candidate.boundingBox),
            confidence: candidate.confidence
        )
    }

    private func hasLiveTextCandidate(_ candidate: LiveTextCandidateObservation, in existing: [LiveTextCandidate]) -> Bool {
        let normalizedValue = candidate.value.uppercased()
        return existing.contains { $0.kind == candidate.kind && $0.value.uppercased() == normalizedValue }
    }

    private func replacementIndex(for candidate: LiveTextCandidateObservation, in existing: [LiveTextCandidate]) -> Int? {
        switch candidate.kind {
        case .imei:
            return nil
        case .model, .serial, .sku:
            return existing.firstIndex { $0.kind == candidate.kind }
        }
    }

    private func canAppendLiveTextCandidate(_ candidate: LiveTextCandidateObservation, to existing: [LiveTextCandidate]) -> Bool {
        let existingKindCount = existing.filter { $0.kind == candidate.kind }.count
        switch candidate.kind {
        case .imei:
            return existingKindCount < 2
        case .model, .serial, .sku:
            return existingKindCount < 1
        }
    }

    private func shouldReplaceLiveTextCandidate(
        _ candidate: LiveTextCandidateObservation,
        replacing existing: LiveTextCandidate
    ) -> Bool {
        let key = "\(candidate.kind.rawValue):\(candidate.value.uppercased())"
        let observationCount = (liveTextReplacementObservationCounts[key] ?? 0) + 1
        liveTextReplacementObservationCounts[key] = observationCount
        guard observationCount >= 2 else { return false }

        return observationCount >= 3
            || candidate.value.count >= existing.value.count
            || candidate.confidence > existing.confidence + 0.08
    }

    private func previewRect(forVisionBoundingBox boundingBox: CGRect) -> CGRect {
        let bounds = previewLayer.bounds
        return CGRect(
            x: boundingBox.minX * bounds.width,
            y: (1 - boundingBox.maxY) * bounds.height,
            width: boundingBox.width * bounds.width,
            height: boundingBox.height * bounds.height
        )
    }

    private func bestCandidate(from objects: [AVMetadataMachineReadableCodeObject]) -> ClipBarcodeCandidate? {
        objects
            .compactMap { object -> ClipBarcodeCandidate? in
                guard let value = object.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !value.isEmpty,
                      let transformed = previewLayer.transformedMetadataObject(for: object),
                      transformed.bounds.width > 0,
                      transformed.bounds.height > 0
                else { return nil }
                return ClipBarcodeCandidate(object: object, bounds: transformed.bounds, value: value)
            }
            .sorted(by: barcodePrioritySort)
            .first
    }

    private func barcodePrioritySort(_ lhs: ClipBarcodeCandidate, _ rhs: ClipBarcodeCandidate) -> Bool {
        let lhsPriority = barcodePriority(lhs.object.type, value: lhs.value)
        let rhsPriority = barcodePriority(rhs.object.type, value: rhs.value)
        if lhsPriority != rhsPriority {
            return lhsPriority < rhsPriority
        }
        return lhs.bounds.width * lhs.bounds.height > rhs.bounds.width * rhs.bounds.height
    }

    private func barcodePriority(_ type: AVMetadataObject.ObjectType, value: String) -> Int {
        switch type {
        case .ean13, .ean8, .upce:
            if upcADigitCount(type, value: value) { return 0 }
            return retailDigitCount(value) ? 1 : 3
        case .code128, .code39, .code39Mod43, .code93, .interleaved2of5, .itf14:
            return 2
        case .qr:
            return 3
        case .pdf417, .aztec, .dataMatrix:
            return 4
        default:
            return 5
        }
    }

    private func setZoomFactor(_ factor: CGFloat) {
        guard let videoDevice else { return }
        let clampedFactor = CameraZoomController.clampedRawZoomFactor(factor, for: videoDevice)
        sessionQueue.async { [weak self] in
            do {
                let zoomState = try CameraZoomController.setRawZoomFactor(clampedFactor, on: videoDevice)
                Task { @MainActor in
                    self?.applyZoomState(zoomState)
                }
            } catch {
                Task { @MainActor in
                    self?.onError?(error.localizedDescription)
                }
            }
        }
    }

    nonisolated private func clampedRawZoomFactor(_ factor: CGFloat, for device: AVCaptureDevice) -> CGFloat {
        CameraZoomController.clampedRawZoomFactor(factor, for: device)
    }

    nonisolated private func displayZoomFactorMultiplier(for device: AVCaptureDevice) -> CGFloat {
        CameraZoomController.displayZoomFactorMultiplier(for: device)
    }

    private func updateZoomState(for device: AVCaptureDevice, rawZoomFactor: CGFloat) {
        applyZoomState(CameraZoomController.state(for: device, rawZoomFactor: rawZoomFactor))
    }

    private func applyZoomState(_ state: CameraZoomState) {
        displayZoomFactor = state.displayFactor
        zoomDisplayLabel = state.displayLabel
        onCameraStateChanged?()
    }

    nonisolated private func resetZoomToDisplayOne(for device: AVCaptureDevice) {
        do {
            let state = try CameraZoomController.resetToDisplayOne(on: device)
            Task { @MainActor in
                self.applyZoomState(state)
            }
        } catch {
            Task { @MainActor in
                self.onError?(error.localizedDescription)
            }
        }
    }

    private func upcADigitCount(_ type: AVMetadataObject.ObjectType, value: String) -> Bool {
        let digits = value.filter(\.isNumber)
        if type == .ean13 {
            return digits.count == 13 && digits.first == "0"
        }
        return digits.count == 12
    }

    private func retailDigitCount(_ value: String) -> Bool {
        let count = value.filter(\.isNumber).count
        return count == 8 || count == 12 || count == 13
    }

    private func normalizedFormat(_ format: String) -> String {
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
        return rawValue.replacingOccurrences(of: "org.iso.", with: "")
    }
}

private enum ClipCameraCaptureError: LocalizedError {
    case cameraAccessDenied
    case photoCaptureUnavailable
    case invalidPhotoData

    var errorDescription: String? {
        switch self {
        case .cameraAccessDenied:
            "Camera access is required to capture."
        case .photoCaptureUnavailable:
            "Photo capture is not available."
        case .invalidPhotoData:
            "The camera did not return a usable photo."
        }
    }
}

private final class ClipPhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    var onFinish: ((Result<UIImage, Error>) -> Void)?
    private var didFinish = false

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        guard !didFinish else { return }
        didFinish = true

        if let error {
            onFinish?(.failure(error))
            return
        }
        guard let data = photo.fileDataRepresentation(),
              let image = UIImage(data: data)
        else {
            onFinish?(.failure(ClipCameraCaptureError.invalidPhotoData))
            return
        }
        onFinish?(.success(image))
    }
}

extension ClipBarcodeScannerService: AVCaptureMetadataOutputObjectsDelegate {
    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        let metadata = ClipBarcodeMetadataObjects(
            metadataObjects
                .compactMap { $0 as? AVMetadataMachineReadableCodeObject }
                .filter { $0.stringValue?.isEmpty == false }
        )
        Task { @MainActor in
            emitBestScan(from: metadata.objects)
        }
    }
}

private final class ClipBarcodeMetadataObjects: @unchecked Sendable {
    let objects: [AVMetadataMachineReadableCodeObject]

    init(_ objects: [AVMetadataMachineReadableCodeObject]) {
        self.objects = objects
    }
}

private struct ClipBarcodeCandidate {
    let object: AVMetadataMachineReadableCodeObject
    let bounds: CGRect
    let value: String
}

private final class ClipLiveTextFrameProcessor: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    var onCandidates: (@Sendable ([LiveTextCandidateObservation]) -> Void)?
    var isEnabled = false
    private var isRecognizing = false
    private var lastRecognitionAt = ContinuousClock.now
    private let recognitionInterval: Duration = .milliseconds(500)
    private var lastCandidates: [LiveTextCandidateObservation] = []

    func reset() {
        lastCandidates = []
        onCandidates?([])
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard isEnabled, !isRecognizing else { return }
        let now = ContinuousClock.now
        guard lastRecognitionAt.duration(to: now) >= recognitionInterval else { return }

        lastRecognitionAt = now
        isRecognizing = true
        recognize(sampleBuffer)
    }

    private func recognize(_ sampleBuffer: CMSampleBuffer) {
        let request = VNRecognizeTextRequest { [weak self] request, _ in
            guard let self else { return }
            let observations = request.results as? [VNRecognizedTextObservation] ?? []
            let candidates = Self.candidates(from: observations)
            if candidates != lastCandidates {
                lastCandidates = candidates
                onCandidates?(candidates)
            }
            isRecognizing = false
        }
        request.recognitionLevel = .fast
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        request.customWords = ["IMEI", "MEID", "Serial", "S/N", "SN", "Model", "Model No", "SKU", "CFI", "CF1", "CFL", "CFI-ZCT1W"]
        request.minimumTextHeight = 0.006

        do {
            try VNImageRequestHandler(cmSampleBuffer: sampleBuffer, orientation: .right).perform([request])
        } catch {
            isRecognizing = false
        }
    }

    private static func candidates(from observations: [VNRecognizedTextObservation]) -> [LiveTextCandidateObservation] {
        let snapshots = observations.compactMap { observation -> LiveTextObservationSnapshot? in
            guard let text = observation.topCandidates(1).first else { return nil }
            return LiveTextObservationSnapshot(
                text: text.string,
                boundingBox: observation.boundingBox,
                confidence: text.confidence
            )
        }

        let directCandidates = observations
            .compactMap { observation -> LiveTextCandidateObservation? in
                guard let text = observation.topCandidates(1).first else { return nil }
                guard let match = LiveTextIdentifierMatcher.match(text.string) else { return nil }
                let matchedBox = (try? text.boundingBox(for: match.range))?.boundingBox ?? observation.boundingBox
                return LiveTextCandidateObservation(
                    kind: match.kind,
                    value: match.value,
                    boundingBox: matchedBox,
                    confidence: text.confidence
                )
            }

        return LiveTextCandidateObservationExtractor.prioritizedCandidates(
            directCandidates: directCandidates,
            snapshots: snapshots
        )
    }
}
