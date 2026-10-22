@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ClipCaptureSessionBackdrop: View {
    let cameraService: ClipBarcodeScannerService
    let activeMode: CaptureMode
    let gridVisible: Bool
    let detectedBarcodeBounds: CGRect?
    let detectedBarcodeFormat: String?
    let focusPoint: CGPoint?
    let onTap: (CGPoint, CGPoint) -> Void
    let onPinch: (CGFloat, CameraZoomGesturePhase) -> Void

    var body: some View {
        ZStack(alignment: .top) {
            Color.black
                .ignoresSafeArea()

            if activeMode != .photo {
                ClipCameraPreview(service: cameraService, onTap: onTap, onPinch: onPinch)
                    .ignoresSafeArea()
                    .overlay {
                        CaptureGuideOverlay(mode: activeMode, gridVisible: gridVisible)
                            .allowsHitTesting(false)
                    }
                    .overlay(alignment: .topLeading) {
                        if activeMode == .barcode,
                           let detectedBarcodeBounds,
                           detectedBarcodeBounds.width > 0,
                           detectedBarcodeBounds.height > 0 {
                            BarcodeDetectionReticle(
                                bounds: detectedBarcodeBounds,
                                format: detectedBarcodeFormat
                            )
                            .allowsHitTesting(false)
                        }
                    }
                    .overlay(alignment: .topLeading) {
                        if let focusPoint {
                            FocusReticle()
                                .position(focusPoint)
                                .allowsHitTesting(false)
                        }
                    }
            }
        }
    }
}

struct ClipPhotoPreview: View {
    let cameraService: ClipBarcodeScannerService
    let gridVisible: Bool
    let focusPoint: CGPoint?
    let onTap: (CGPoint, CGPoint) -> Void
    let onPinch: (CGFloat, CameraZoomGesturePhase) -> Void

    var body: some View {
        ClipCameraPreview(service: cameraService, onTap: onTap, onPinch: onPinch)
            .clipped()
            .overlay {
                if gridVisible {
                    SquareGrid()
                        .allowsHitTesting(false)
                }
            }
            .overlay {
                Rectangle()
                    .stroke(.white.opacity(0.28), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .overlay(alignment: .topLeading) {
                if let focusPoint {
                    FocusReticle()
                        .position(focusPoint)
                        .allowsHitTesting(false)
                }
            }
    }
}

struct ClipCameraPreview: UIViewRepresentable {
    let service: ClipBarcodeScannerService
    let onTap: (CGPoint, CGPoint) -> Void
    let onPinch: (CGFloat, CameraZoomGesturePhase) -> Void

    func makeUIView(context: Context) -> ClipCameraPreviewHostView {
        let view = ClipCameraPreviewHostView(previewLayer: service.previewLayer)
        view.onTap = onTap
        view.onPinch = onPinch
        return view
    }

    func updateUIView(_ uiView: ClipCameraPreviewHostView, context: Context) {
        uiView.setPreviewLayer(service.previewLayer)
        uiView.onTap = onTap
        uiView.onPinch = onPinch
    }

    final class ClipCameraPreviewHostView: UIView {
        private var previewLayer: AVCaptureVideoPreviewLayer
        var onTap: ((CGPoint, CGPoint) -> Void)?
        var onPinch: ((CGFloat, CameraZoomGesturePhase) -> Void)?

        init(previewLayer: AVCaptureVideoPreviewLayer) {
            self.previewLayer = previewLayer
            super.init(frame: .zero)
            layer.addSublayer(previewLayer)
            let tapRecognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
            addGestureRecognizer(tapRecognizer)
            let pinchRecognizer = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
            addGestureRecognizer(pinchRecognizer)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }

        func setPreviewLayer(_ nextLayer: AVCaptureVideoPreviewLayer) {
            guard previewLayer !== nextLayer else { return }
            previewLayer.removeFromSuperlayer()
            previewLayer = nextLayer
            layer.addSublayer(nextLayer)
            setNeedsLayout()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            previewLayer.frame = bounds
        }

        @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
            let layerPoint = recognizer.location(in: self)
            let devicePoint = previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint)
            onTap?(devicePoint, layerPoint)
        }

        @objc private func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
            switch recognizer.state {
            case .began:
                onPinch?(recognizer.scale, .began)
            case .changed:
                onPinch?(recognizer.scale, .changed)
            case .ended, .cancelled, .failed:
                onPinch?(recognizer.scale, .ended)
            default:
                break
            }
        }
    }
}
