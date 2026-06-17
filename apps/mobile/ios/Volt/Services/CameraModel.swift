@preconcurrency import AVFoundation
import Observation
import UIKit

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
        sessionQueue.async {
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
        lastBarcode = nil
        lastBarcodeFormat = nil
        detectedBarcodeBounds = nil
        detectedBarcodeFormat = nil
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
            metadataOutput.metadataObjectTypes = supportedBarcodeTypes.filter {
                metadataOutput.availableMetadataObjectTypes.contains($0)
            }
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

    private var supportedBarcodeTypes: [AVMetadataObject.ObjectType] {
        [
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
}

extension CameraModel: AVCaptureMetadataOutputObjectsDelegate {
    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard let object = metadataObjects
            .compactMap({ $0 as? AVMetadataMachineReadableCodeObject })
            .filter({ $0.stringValue?.isEmpty == false })
            .sorted(by: barcodePrioritySort)
            .first,
              let value = object.stringValue
        else {
            Task { @MainActor in
                detectedBarcodeBounds = nil
                detectedBarcodeFormat = nil
            }
            return
        }

        let format = object.type.rawValue
        Task { @MainActor in
            detectedBarcodeBounds = previewLayer.transformedMetadataObject(for: object)?.bounds
            detectedBarcodeFormat = format
            if lastBarcode != value || lastBarcodeFormat != format {
                lastBarcode = value
                lastBarcodeFormat = format
            }
        }
    }

    private nonisolated func barcodePrioritySort(
        _ lhs: AVMetadataMachineReadableCodeObject,
        _ rhs: AVMetadataMachineReadableCodeObject
    ) -> Bool {
        barcodePriority(lhs.type) < barcodePriority(rhs.type)
    }

    private nonisolated func barcodePriority(_ type: AVMetadataObject.ObjectType) -> Int {
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
