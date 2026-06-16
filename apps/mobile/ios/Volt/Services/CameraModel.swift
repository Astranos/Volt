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

    var authorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    var lastBarcode: String?
    var lastBarcodeFormat: String?
    var lastPhoto: UIImage?
    var errorMessage: String?

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
        if authorizationStatus == .authorized {
            configureIfNeeded()
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
        let session = session
        sessionQueue.async {
            if session.isRunning {
                session.stopRunning()
            }
        }
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
            let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: camera),
            session.canAddInput(input)
        else {
            errorMessage = "Camera is not available."
            session.commitConfiguration()
            return
        }

        session.addInput(input)
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
        else { return }

        let format = object.type.rawValue
        Task { @MainActor in
            guard lastBarcode != value || lastBarcodeFormat != format else { return }
            lastBarcode = value
            lastBarcodeFormat = format
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
