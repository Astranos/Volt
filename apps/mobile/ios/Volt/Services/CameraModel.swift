@preconcurrency import AVFoundation
import Observation
import UIKit

enum BarcodeRecognitionMode: String, CaseIterable, Identifiable {
    case upc = "upc"
    case qr = "qr"
    case code128 = "code128"
    case code39And93 = "code39And93"
    case itf = "itf"
    case dataMatrix = "dataMatrix"
    case pdf417 = "pdf417"
    case all = "all"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .upc:
            "UPC / EAN"
        case .qr:
            "QR"
        case .code128:
            "Code 128"
        case .code39And93:
            "Code 39 / 93"
        case .itf:
            "ITF"
        case .dataMatrix:
            "Data Matrix"
        case .pdf417:
            "PDF417"
        case .all:
            "All"
        }
    }

    var metadataObjectTypes: [AVMetadataObject.ObjectType] {
        switch self {
        case .upc:
            [.ean13, .ean8, .upce]
        case .qr:
            [.qr]
        case .code128:
            [.code128]
        case .code39And93:
            [.code39, .code39Mod43, .code93]
        case .itf:
            [.interleaved2of5, .itf14]
        case .dataMatrix:
            [.dataMatrix]
        case .pdf417:
            [.pdf417]
        case .all:
            Self.allSupportedMetadataObjectTypes
        }
    }

    static let allSupportedMetadataObjectTypes: [AVMetadataObject.ObjectType] = [
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
        .upce
    ]
}

@MainActor
@Observable
final class CameraModel: NSObject {
    let session = AVCaptureSession()
    let previewLayer = AVCaptureVideoPreviewLayer()
    private let metadataOutput = AVCaptureMetadataOutput()
    private let photoOutput = AVCapturePhotoOutput()
    private var photoContinuation: CheckedContinuation<UIImage?, Never>?
    private let sessionQueue = DispatchQueue(label: "com.volt.mobile.camera-session")
    private let metadataQueue = DispatchQueue(label: "com.volt.mobile.camera-metadata")
    private var videoDevice: AVCaptureDevice?

    var authorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    var lastBarcode: String?
    var lastBarcodeFormat: String?
    var detectedBarcodeBounds: CGRect?
    var detectedBarcodeFormat: String?
    var lastPhoto: UIImage?
    var errorMessage: String?
    var torchEnabled = false
    var zoomFactor: CGFloat = 1
    var displayZoomFactor: CGFloat = 1
    var zoomDisplayLabel = "1x"
    var minZoomFactor: CGFloat = 1
    var maxZoomFactor: CGFloat = 1
    var minDisplayZoomFactor: CGFloat = 1
    var maxDisplayZoomFactor: CGFloat = 1
    var barcodeRecognitionMode: BarcodeRecognitionMode = .upc
    private var barcodeGuideRect: CGRect?
    private var barcodeDetectionRevision = 0
    private var barcodeClearTask: Task<Void, Never>?

    override init() {
        super.init()
        previewLayer.session = session
        previewLayer.videoGravity = .resizeAspectFill
    }

    func requestAccess() async {
        if authorizationStatus == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
            authorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
        }
    }

    func start() {
        guard authorizationStatus == .authorized else { return }
        configureIfNeeded()
        let session = session
        let videoDevice = videoDevice
        sessionQueue.async {
            if let videoDevice {
                self.resetZoomToDisplayOne(for: videoDevice)
            }
            if !session.isRunning {
                session.startRunning()
            }
        }
    }

    func stop() {
        clearDetectedBarcode()
        let session = session
        sessionQueue.async {
            if session.isRunning {
                session.stopRunning()
            }
        }
    }

    func clearDetectedBarcode() {
        barcodeDetectionRevision += 1
        barcodeClearTask?.cancel()
        barcodeClearTask = nil
        lastBarcode = nil
        lastBarcodeFormat = nil
        detectedBarcodeBounds = nil
        detectedBarcodeFormat = nil
    }

    func updateBarcodeGuideRect(_ rect: CGRect?) {
        barcodeGuideRect = rect
    }

    func capturePhoto() async -> UIImage? {
        await withCheckedContinuation { continuation in
            photoContinuation = continuation
            photoOutput.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
        }
    }

    private func configureIfNeeded() {
        guard session.inputs.isEmpty else { return }
        session.beginConfiguration()
        session.sessionPreset = .photo

        guard
            let camera = Self.bestBackCamera(),
            let input = try? AVCaptureDeviceInput(device: camera),
            session.canAddInput(input)
        else {
            errorMessage = "Camera is not available."
            session.commitConfiguration()
            return
        }

        session.addInput(input)
        videoDevice = camera
        updateZoomState(for: camera, rawZoomFactor: camera.videoZoomFactor)
        if session.canAddOutput(metadataOutput) {
            session.addOutput(metadataOutput)
            metadataOutput.setMetadataObjectsDelegate(self, queue: metadataQueue)
            applyBarcodeRecognitionMode(barcodeRecognitionMode)
        }
        if session.canAddOutput(photoOutput) {
            session.addOutput(photoOutput)
        }

        session.commitConfiguration()
    }

    private static func bestBackCamera() -> AVCaptureDevice? {
        let preferredDeviceTypes: [AVCaptureDevice.DeviceType] = [
            .builtInTripleCamera,
            .builtInDualWideCamera,
            .builtInDualCamera,
            .builtInWideAngleCamera
        ]

        return preferredDeviceTypes.lazy.compactMap {
            AVCaptureDevice.default($0, for: .video, position: .back)
        }.first
    }

    func updateBarcodeRecognitionMode(_ mode: BarcodeRecognitionMode) {
        barcodeRecognitionMode = mode
        applyBarcodeRecognitionMode(mode)
    }

    private func applyBarcodeRecognitionMode(_ mode: BarcodeRecognitionMode) {
        guard metadataOutput.connections.isEmpty == false else { return }
        let requestedTypes = mode.metadataObjectTypes
        let availableTypes = metadataOutput.availableMetadataObjectTypes
        let selectedTypes = requestedTypes.filter { availableTypes.contains($0) }
        metadataOutput.metadataObjectTypes = selectedTypes
        clearDetectedBarcode()
    }

    func setTorchEnabled(_ enabled: Bool) {
        guard let videoDevice, videoDevice.hasTorch else { return }
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
                }
            } catch {
                Task { @MainActor in
                    self?.errorMessage = error.localizedDescription
                }
            }
        }
    }

    func setZoomFactor(_ factor: CGFloat) {
        guard let videoDevice else { return }
        let clampedFactor = clampedRawZoomFactor(factor, for: videoDevice)
        sessionQueue.async { [weak self] in
            do {
                try videoDevice.lockForConfiguration()
                videoDevice.videoZoomFactor = clampedFactor
                videoDevice.unlockForConfiguration()
                Task { @MainActor in
                    self?.updateZoomState(for: videoDevice, rawZoomFactor: clampedFactor)
                }
            } catch {
                Task { @MainActor in
                    self?.errorMessage = error.localizedDescription
                }
            }
        }
    }

    func adjustZoom(by delta: CGFloat) {
        setDisplayZoomFactor(displayZoomFactor + delta)
    }

    private func setDisplayZoomFactor(_ factor: CGFloat) {
        guard let videoDevice else { return }
        setZoomFactor(factor / displayZoomFactorMultiplier(for: videoDevice))
    }

    func scaleZoom(by scale: CGFloat) {
        guard let videoDevice else { return }
        sessionQueue.async { [weak self] in
            do {
                try videoDevice.lockForConfiguration()
                let clampedFactor = self?.clampedRawZoomFactor(videoDevice.videoZoomFactor * scale, for: videoDevice)
                    ?? videoDevice.videoZoomFactor
                videoDevice.videoZoomFactor = clampedFactor
                videoDevice.unlockForConfiguration()
                Task { @MainActor in
                    self?.updateZoomState(for: videoDevice, rawZoomFactor: clampedFactor)
                }
            } catch {
                Task { @MainActor in
                    self?.errorMessage = error.localizedDescription
                }
            }
        }
    }

    nonisolated private func clampedRawZoomFactor(_ factor: CGFloat, for device: AVCaptureDevice) -> CGFloat {
        let maxDisplayZoomFactor: CGFloat = 6
        let displayMultiplier = displayZoomFactorMultiplier(for: device)
        let displayLimitedMaxZoomFactor = maxDisplayZoomFactor / displayMultiplier
        let maxZoomFactor = min(device.maxAvailableVideoZoomFactor, displayLimitedMaxZoomFactor)
        return max(device.minAvailableVideoZoomFactor, min(maxZoomFactor, factor))
    }

    nonisolated private func displayZoomFactorMultiplier(for device: AVCaptureDevice) -> CGFloat {
        max(device.displayVideoZoomFactorMultiplier, .leastNonzeroMagnitude)
    }

    private func updateZoomState(for device: AVCaptureDevice, rawZoomFactor: CGFloat) {
        let clampedFactor = clampedRawZoomFactor(rawZoomFactor, for: device)
        let displayMultiplier = displayZoomFactorMultiplier(for: device)
        let displayFactor = clampedFactor * displayMultiplier

        minZoomFactor = device.minAvailableVideoZoomFactor
        maxZoomFactor = clampedRawZoomFactor(device.maxAvailableVideoZoomFactor, for: device)
        zoomFactor = clampedFactor
        minDisplayZoomFactor = minZoomFactor * displayMultiplier
        maxDisplayZoomFactor = maxZoomFactor * displayMultiplier
        displayZoomFactor = displayFactor
        let roundedDisplayFactor = (Double(displayFactor) * 10).rounded() / 10
        zoomDisplayLabel = "\(roundedDisplayFactor.formatted(.number.precision(.fractionLength(0...1))))x"
    }

    nonisolated private func resetZoomToDisplayOne(for device: AVCaptureDevice) {
        do {
            try device.lockForConfiguration()
            let rawZoomFactor = clampedRawZoomFactor(1 / displayZoomFactorMultiplier(for: device), for: device)
            device.videoZoomFactor = rawZoomFactor
            device.unlockForConfiguration()
            Task { @MainActor in
                self.updateZoomState(for: device, rawZoomFactor: rawZoomFactor)
            }
        } catch {
            Task { @MainActor in
                self.errorMessage = error.localizedDescription
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
                    self?.errorMessage = error.localizedDescription
                }
            }
        }
    }

}

private final class BarcodeMetadataObjects: @unchecked Sendable {
    let objects: [AVMetadataMachineReadableCodeObject]

    init(_ objects: [AVMetadataMachineReadableCodeObject]) {
        self.objects = objects
    }
}

private struct BarcodeCandidate {
    let object: AVMetadataMachineReadableCodeObject
    let bounds: CGRect
    let value: String
}

extension CameraModel: AVCaptureMetadataOutputObjectsDelegate {
    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        let objects = metadataObjects
            .compactMap { $0 as? AVMetadataMachineReadableCodeObject }
            .filter { $0.stringValue?.isEmpty == false }
        let metadata = BarcodeMetadataObjects(objects)

        Task { @MainActor in
            guard let candidate = bestBarcodeCandidate(from: metadata.objects)
            else {
                detectedBarcodeBounds = nil
                detectedBarcodeFormat = nil
                return
            }

            let format = candidate.object.type.rawValue
            detectedBarcodeBounds = candidate.bounds
            detectedBarcodeFormat = format
            if lastBarcode != candidate.value || lastBarcodeFormat != format {
                lastBarcode = candidate.value
                lastBarcodeFormat = format
            }
            scheduleStaleBarcodeClear()
        }
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

    private func bestBarcodeCandidate(
        from objects: [AVMetadataMachineReadableCodeObject]
    ) -> BarcodeCandidate? {
        let candidates = objects.compactMap { object -> BarcodeCandidate? in
            guard let transformed = previewLayer.transformedMetadataObject(for: object),
                  transformed.bounds.width > 0,
                  transformed.bounds.height > 0,
                  let value = object.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty
            else { return nil }
            return BarcodeCandidate(object: object, bounds: transformed.bounds, value: value)
        }

        guard let guideRect = barcodeGuideRect, guideRect.width > 0, guideRect.height > 0 else {
            return candidates.sorted(by: barcodePrioritySort).first
        }

        let guidedCandidates = candidates.filter { candidate in
            guideRect.contains(CGPoint(x: candidate.bounds.midX, y: candidate.bounds.midY))
                || barcodeGuideOverlapRatio(candidate.bounds, guideRect) >= 0.35
        }
        let retailCandidates = guidedCandidates.filter(isRetailUPCorEAN)
        let selectableCandidates = retailCandidates.isEmpty ? guidedCandidates : retailCandidates

        return selectableCandidates.sorted { lhs, rhs in
            let lhsScore = barcodeGuideScore(lhs, guideRect: guideRect)
            let rhsScore = barcodeGuideScore(rhs, guideRect: guideRect)
            if lhsScore != rhsScore {
                return lhsScore < rhsScore
            }
            return barcodePrioritySort(lhs, rhs)
        }.first
    }

    private func barcodeGuideOverlapRatio(_ bounds: CGRect, _ guideRect: CGRect) -> CGFloat {
        let intersection = bounds.intersection(guideRect)
        guard !intersection.isNull else { return 0 }
        let boundsArea = max(bounds.width * bounds.height, .leastNonzeroMagnitude)
        return (intersection.width * intersection.height) / boundsArea
    }

    private func barcodePrioritySort(
        _ lhs: BarcodeCandidate,
        _ rhs: BarcodeCandidate
    ) -> Bool {
        let lhsPriority = barcodePriority(lhs.object.type)
        let rhsPriority = barcodePriority(rhs.object.type)
        if lhsPriority != rhsPriority {
            return lhsPriority < rhsPriority
        }
        return lhs.bounds.width * lhs.bounds.height > rhs.bounds.width * rhs.bounds.height
    }

    private func barcodeGuideScore(_ candidate: BarcodeCandidate, guideRect: CGRect) -> CGFloat {
        let guideWidth = max(guideRect.width, .leastNonzeroMagnitude)
        let guideHeight = max(guideRect.height, .leastNonzeroMagnitude)
        let centerXDistance = abs(candidate.bounds.midX - guideRect.midX) / guideWidth
        let centerYDistance = abs(candidate.bounds.midY - guideRect.midY) / guideHeight
        let overlapRatio = barcodeGuideOverlapRatio(candidate.bounds, guideRect)
        let widthRatio = min(candidate.bounds.width / guideWidth, 1)
        let scanLineCrossesBounds = candidate.bounds.minY <= guideRect.midY && candidate.bounds.maxY >= guideRect.midY

        var score = CGFloat(barcodePriority(candidate.object.type) * 1_000)
        if !isRetailUPCorEAN(candidate) {
            score += 5_000
        }
        if isSupplementalRetailCode(candidate.value) {
            score += 4_000
        }
        if scanLineCrossesBounds {
            score -= 350
        }
        score += centerXDistance * 260
        score += centerYDistance * 180
        score += (1 - overlapRatio) * 520
        score -= widthRatio * 480
        return score
    }

    private func barcodePriority(_ type: AVMetadataObject.ObjectType) -> Int {
        switch type {
        case .ean13, .ean8, .upce:
            0
        case .code128, .code39, .code39Mod43, .code93, .interleaved2of5, .itf14:
            1
        case .qr, .pdf417, .aztec, .dataMatrix:
            2
        default:
            3
        }
    }

    private func isRetailUPCorEAN(_ candidate: BarcodeCandidate) -> Bool {
        guard barcodePriority(candidate.object.type) == 0 else { return false }
        let digits = digitString(candidate.value)
        return digits.count == 8 || digits.count == 12 || digits.count == 13
    }

    private func isSupplementalRetailCode(_ value: String) -> Bool {
        let digits = digitString(value)
        return digits.count == 2 || digits.count == 5
    }

    private func digitString(_ value: String) -> String {
        String(value.filter(\.isNumber))
    }
}

extension CameraModel: AVCapturePhotoCaptureDelegate {
    nonisolated func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        let image = photo.fileDataRepresentation().flatMap(UIImage.init(data:))
        Task { @MainActor in
            lastPhoto = image
            photoContinuation?.resume(returning: image)
            photoContinuation = nil
        }
    }
}
