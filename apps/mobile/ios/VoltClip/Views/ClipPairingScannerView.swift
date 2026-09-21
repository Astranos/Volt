@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ClipPairingScannerView: View {
    @Bindable var store: ClipScannerStore
    let onFinish: () -> Void
    @State private var hasDetectedCode = false

    var body: some View {
        ZStack {
            ClipQRCodeScannerView { value in
                hasDetectedCode = true
                if store.pairFromScannedValue(value) {
                    onFinish()
                }
            }
            .ignoresSafeArea()

            VStack {
                Spacer()

                PairingScanControls(
                    statusText: store.statusText,
                    statusDetail: statusDetail,
                    onFinish: onFinish
                )
            }
        }
        .background(.black)
    }

    private var statusDetail: String {
        if store.isPairing {
            return "QR accepted. Starting the pairing request."
        }
        if store.isConnected {
            return "Ready to send captures back to the browser."
        }
        if store.errorMessage != nil {
            return "Try refreshing the pairing QR and scan it again."
        }
        return hasDetectedCode ? "Hold steady while the QR is read." : "Center the browser pairing QR in the frame."
    }
}

struct ClipQRCodeScannerView: UIViewRepresentable {
    let onCode: (String) -> Void

    func makeUIView(context: Context) -> QRPreviewView {
        let view = QRPreviewView()
        view.previewLayer.videoGravity = .resizeAspectFill
        context.coordinator.configureSession(for: view)
        return view
    }

    func updateUIView(_ uiView: QRPreviewView, context: Context) {}

    static func dismantleUIView(_ uiView: QRPreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode)
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
        private let onCode: (String) -> Void
        private let session = AVCaptureSession()
        private var didEmitCode = false

        init(onCode: @escaping (String) -> Void) {
            self.onCode = onCode
            super.init()
        }

        func configureSession(for view: QRPreviewView) {
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                Task { @MainActor in
                    startSession(for: view)
                }
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { [weak self, weak view] granted in
                    guard granted, let self, let view else { return }
                    Task { @MainActor in
                        self.startSession(for: view)
                    }
                }
            case .denied, .restricted:
                break
            @unknown default:
                break
            }
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard !didEmitCode else { return }
            guard let qrObject = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first(where: { $0.type == .qr }),
                  let value = qrObject.stringValue else { return }
            didEmitCode = true
            onCode(value)
        }

        func stop() {
            guard session.isRunning else { return }
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                session.stopRunning()
            }
        }

        @MainActor
        private func startSession(for view: QRPreviewView) {
            guard !session.isRunning else { return }
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else { return }

            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }

            session.beginConfiguration()
            session.addInput(input)
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = output.availableMetadataObjectTypes.contains(.qr) ? [.qr] : []
            session.commitConfiguration()

            view.previewLayer.session = session
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                session.startRunning()
            }
        }
    }

    final class QRPreviewView: UIView {
        override class var layerClass: AnyClass {
            AVCaptureVideoPreviewLayer.self
        }

        var previewLayer: AVCaptureVideoPreviewLayer {
            layer as! AVCaptureVideoPreviewLayer
        }
    }
}
