import SwiftUI

struct ScannerCameraLayer: View {
    @Environment(ScannerStore.self) private var store
    @State private var focusPoint: CGPoint?
    var gridVisible = false
    var guideVisible = true
    var barcodeDetectionLabel: String?
    private let photoHeaderClearance: CGFloat = 48
    private let photoControlsReservedHeight: CGFloat = 318

    var body: some View {
        Group {
            if store.camera.authorizationStatus == .authorized {
                GeometryReader { proxy in
                    ZStack(alignment: .top) {
                        Color.black
                            .ignoresSafeArea()

                        if store.activeMode == .photo {
                            photoPreview(in: proxy)
                        } else {
                            cameraPreview
                                .ignoresSafeArea()
                                .overlay(alignment: .center) {
                                    if guideVisible {
                                        CaptureGuideOverlay(mode: store.activeMode, gridVisible: gridVisible)
                                            .allowsHitTesting(false)
                                    }
                                }
                        }
                    }
                }
            } else {
                ContentUnavailableView(
                    "Camera Access Required",
                    systemImage: "camera",
                    description: Text("Enable camera access to capture documents.")
                )
            }
        }
    }

    private var cameraPreview: some View {
        CameraPreview(
            previewLayer: store.camera.previewLayer,
            onTap: { devicePoint, layerPoint in
                focusPoint = layerPoint
                store.camera.focus(at: devicePoint)
                Task {
                    try? await Task.sleep(for: .milliseconds(750))
                    await MainActor.run {
                        if focusPoint == layerPoint {
                            focusPoint = nil
                        }
                    }
                }
            },
            onPinch: { scale in
                store.camera.scaleZoom(by: scale)
            }
        )
        .overlay(alignment: .topLeading) {
            if let focusPoint {
                FocusReticle()
                    .position(focusPoint)
                    .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .topLeading) {
            if let barcodeBounds = store.camera.detectedBarcodeBounds,
               barcodeBounds.width > 0,
               barcodeBounds.height > 0 {
                BarcodeDetectionReticle(
                    bounds: barcodeBounds,
                    format: store.camera.detectedBarcodeFormat,
                    labelOverride: barcodeDetectionLabel
                )
                    .allowsHitTesting(false)
            }
        }
    }

    private func photoPreview(in proxy: GeometryProxy) -> some View {
        let topInset = proxy.safeAreaInsets.top + photoHeaderClearance
        let bottomInset = proxy.safeAreaInsets.bottom
        let availableHeight = max(0, proxy.size.height - topInset - bottomInset - photoControlsReservedHeight)
        let side = min(proxy.size.width, availableHeight)
        let topOffset = topInset + max(0, (availableHeight - side) / 2)

        return cameraPreview
            .frame(width: side, height: side)
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
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, topOffset)
    }
}

struct FocusReticle: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .stroke(.yellow, lineWidth: 2)
            .frame(width: 74, height: 74)
            .overlay {
                Circle()
                    .fill(.yellow)
                    .frame(width: 8, height: 8)
            }
            .transition(.scale.combined(with: .opacity))
    }
}

struct BarcodeDetectionReticle: View {
    let bounds: CGRect
    let format: String?
    let labelOverride: String?

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(.green, lineWidth: 3)
                .shadow(color: .black.opacity(0.42), radius: 3, y: 1)

            Text(label)
                .font(.caption2.weight(.bold))
                .foregroundStyle(.black)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.green, in: Capsule())
                .offset(x: 8, y: -28)
        }
        .frame(width: max(42, bounds.width), height: max(42, bounds.height))
        .position(x: bounds.midX, y: bounds.midY)
        .transition(.opacity.combined(with: .scale(scale: 0.96)))
        .animation(.easeOut(duration: 0.12), value: bounds)
        .accessibilityHidden(true)
    }

    private var label: String {
        if let labelOverride, !labelOverride.isEmpty {
            return labelOverride
        }
        guard let format else { return "Code" }
        return format.localizedCaseInsensitiveContains("qr") ? "QR found" : "Code found"
    }
}
