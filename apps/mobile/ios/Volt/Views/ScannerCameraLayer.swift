import SwiftUI

struct ScannerCameraLayer: View {
    @Environment(ScannerStore.self) private var store
    @State private var focusPoint: CGPoint?
    var gridVisible = false
    var guideVisible = true
    private let photoTopClearance: CGFloat = 12
    private let photoControlsReservedHeight: CGFloat = 360

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
                                .onAppear {
                                    updateBarcodeGuideRect(in: proxy)
                                }
                                .onChange(of: proxy.size) { _, _ in
                                    updateBarcodeGuideRect(in: proxy)
                                }
                                .onChange(of: store.activeMode) { _, _ in
                                    updateBarcodeGuideRect(in: proxy)
                                }
                                .onChange(of: guideVisible) { _, _ in
                                    updateBarcodeGuideRect(in: proxy)
                                }
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

    private func updateBarcodeGuideRect(in proxy: GeometryProxy) {
        guard store.activeMode == .barcode else {
            store.camera.updateBarcodeGuideRect(nil)
            store.camera.clearDetectedBarcode()
            return
        }

        if guideVisible {
            store.camera.updateBarcodeGuideRect(
                CaptureGuideGeometry.guideRect(
                    for: .barcode,
                    in: proxy.size,
                    safeAreaInsets: proxy.safeAreaInsets
                )
            )
        } else {
            store.camera.updateBarcodeGuideRect(nil)
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
            if guideVisible,
               store.activeMode == .barcode,
               let barcodeBounds = store.camera.detectedBarcodeBounds,
               barcodeBounds.width > 0,
               barcodeBounds.height > 0 {
                BarcodeDetectionReticle(
                    bounds: barcodeBounds,
                    format: store.camera.detectedBarcodeFormat
                )
                    .allowsHitTesting(false)
            }
        }
    }

    private func photoPreview(in proxy: GeometryProxy) -> some View {
        let topInset = proxy.safeAreaInsets.top + photoTopClearance
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

    var body: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(.green, lineWidth: 3)
            .shadow(color: .black.opacity(0.42), radius: 3, y: 1)
            .frame(width: max(42, bounds.width), height: max(42, bounds.height))
            .position(x: bounds.midX, y: bounds.midY)
            .transition(.opacity.combined(with: .scale(scale: 0.96)))
            .animation(.easeOut(duration: 0.12), value: bounds)
            .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        guard let format else { return "Code" }
        return format.localizedCaseInsensitiveContains("qr") ? "QR found" : "Code found"
    }
}
