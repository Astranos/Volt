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

struct ClipOcrReviewControls: View {
    let regionCount: Int
    let onRetake: () -> Void
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("Tap highlighted text")
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)

            HStack(spacing: 12) {
                Button(action: onRetake) {
                    Label("Retake", systemImage: "arrow.clockwise")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .frame(minWidth: 104, minHeight: 48)
                        .background(.black.opacity(0.86), in: Capsule())
                        .overlay {
                            Capsule().stroke(.white.opacity(0.22), lineWidth: 1)
                        }
                }

                Spacer()

                Label("\(regionCount)", systemImage: "text.viewfinder")
                    .font(.subheadline.monospacedDigit().bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 48)
                    .background(.black.opacity(0.86), in: Capsule())
                    .overlay {
                        Capsule().stroke(.white.opacity(0.22), lineWidth: 1)
                    }
                    .accessibilityLabel("\(regionCount) recognized text regions")

                Spacer()

                Button(action: onFinish) {
                    Label("Finish", systemImage: "checkmark")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .frame(minWidth: 104, minHeight: 48)
                        .background(.black.opacity(0.86), in: Capsule())
                        .overlay {
                            Capsule().stroke(.white.opacity(0.22), lineWidth: 1)
                        }
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 22)
        .background {
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.88), .black.opacity(0.98)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        }
    }
}
