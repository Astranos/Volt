import SwiftUI

struct ScannerCameraLayer: View {
    @Environment(ScannerStore.self) private var store
    @State private var focusPoint: CGPoint?
    var gridVisible = false
    var guideVisible = true
    /// Room for the fixed status surface that floats over the top of the session.
    private let photoTopStatusClearance: CGFloat = 86

    var body: some View {
        Group {
            if let screenshotScenario = ScreenshotScenario.current,
               let screenshotImage = ScannerStore.screenshotCaptureImage(for: screenshotScenario) {
                screenshotPreview(image: screenshotImage, scenario: screenshotScenario)
            } else if store.camera.authorizationStatus == .authorized {
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
                                    updateLiveTextScanning()
                                }
                                .onChange(of: proxy.size) { _, _ in
                                    updateBarcodeGuideRect(in: proxy)
                                }
                                .onChange(of: store.activeMode) { _, _ in
                                    updateBarcodeGuideRect(in: proxy)
                                    updateLiveTextScanning()
                                }
                                .onChange(of: guideVisible) { _, _ in
                                    updateBarcodeGuideRect(in: proxy)
                                }
                                .onDisappear {
                                    store.camera.setLiveTextScanningEnabled(false)
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

        store.camera.updateBarcodeGuideRect(nil)
    }

    private func updateLiveTextScanning() {
        store.camera.setLiveTextScanningEnabled(store.activeMode == .ocr)
        store.camera.setBarcodeScanningEnabled(store.activeMode == .barcode)
    }

    @ViewBuilder
    private func screenshotPreview(image: UIImage, scenario: ScreenshotScenario) -> some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                Color.white
                    .ignoresSafeArea()

                switch scenario {
                case .captureTextPre:
                    screenshotTextPreview(image: image, in: proxy)
                case .captureBarcode:
                    screenshotBarcodePreview(image: image, in: proxy)
                case .capturePhoto:
                    screenshotPhotoPreview(image: image, in: proxy)
                case .sessions, .captureReview, .captureReviewSend, .captureResults, .dictation, .upload:
                    Color.black
                        .ignoresSafeArea()
                }
            }
        }
    }

    private func screenshotTextPreview(image: UIImage, in proxy: GeometryProxy) -> some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
    }

    private func screenshotBarcodePreview(image: UIImage, in proxy: GeometryProxy) -> some View {
        let imageWidth = proxy.size.width
        let imageHeight = proxy.size.height
        let barcodeBounds = CGRect(
            x: proxy.size.width * 0.705,
            y: proxy.size.height * 0.425,
            width: proxy.size.width * 0.205,
            height: proxy.size.height * 0.066
        )

        return ZStack(alignment: .topLeading) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: imageWidth, height: imageHeight)
                .clipped()

            BarcodeDetectionReticle(bounds: barcodeBounds, format: "UPC-A")
        }
        .frame(width: proxy.size.width, height: proxy.size.height)
    }

    private func screenshotPhotoPreview(image: UIImage, in proxy: GeometryProxy) -> some View {
        let layout = photoPreviewLayout(in: proxy)

        return Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .frame(width: layout.side, height: layout.side)
            .clipped()
            .overlay {
                if gridVisible {
                    SquareGrid()
                        .allowsHitTesting(false)
                }
            }
            .overlay {
                Rectangle()
                    .stroke(.white.opacity(0.46), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, layout.topOffset)
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
            onPinch: { scale, phase in
                store.camera.handleZoomGesture(scale: scale, phase: phase)
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

    /// The photo layer is laid out inside the safe area, so `proxy` already excludes the status bar
    /// and the control deck that `safeAreaInset` reserves at the bottom. Only the floating top
    /// status surface still needs manual clearance.
    private func photoPreviewLayout(in proxy: GeometryProxy) -> (side: CGFloat, topOffset: CGFloat) {
        let availableHeight = max(0, proxy.size.height - photoTopStatusClearance)
        let side = max(0, min(proxy.size.width, availableHeight))
        return (side, photoTopStatusClearance + max(0, (availableHeight - side) / 2))
    }

    private func photoPreview(in proxy: GeometryProxy) -> some View {
        let layout = photoPreviewLayout(in: proxy)

        return cameraPreview
            .frame(width: layout.side, height: layout.side)
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
            .padding(.top, layout.topOffset)
    }
}
