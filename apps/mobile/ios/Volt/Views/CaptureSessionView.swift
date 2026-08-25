import SwiftUI

struct CaptureSessionView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var isPresented: Bool
    let mode: CaptureMode
    @State private var gridVisible = true
    @State private var selectedTextRegion: RecognizedTextRegion?
    @State private var selectedCleanedText: String?
    @State private var isShowingRawText = false
    @State private var isCleaningSelectedText = false
    @State private var cleanupRequestID = UUID()
    @State private var isTargetPickerPresented = false

    var body: some View {
        @Bindable var store = store

        ZStack {
            if let reviewImage = store.ocrReviewImage {
                OcrReviewLayer(
                    image: reviewImage,
                    regions: store.ocrTextRegions,
                    selectedRegion: selectedTextRegion,
                    imageContentMode: ScreenshotScenario.isEnabled ? .fill : .fit,
                    fillFocusX: ScreenshotScenario.isEnabled ? 0.565 : 0.5,
                    onSelectRegion: { selectTextRegion($0) }
                )
                    .ignoresSafeArea()
            } else {
                // Photo mode stays inside the safe area so the square viewfinder can centre itself in
                // whatever the status bar and the control deck leave behind. Text and barcode keep
                // their full-bleed preview.
                ScannerCameraLayer(gridVisible: gridVisible)
                    .ignoresSafeArea(edges: store.activeMode == .photo ? [] : .all)
            }

            if selectedTextRegion != nil {
                ExtractedTextActionCard(
                    text: selectedTextPreview,
                    rawText: selectedTextRegion?.text ?? "",
                    isShowingRaw: isShowingRawText,
                    isCleaning: isCleaningSelectedText,
                    onToggleRepresentation: {
                        isShowingRawText.toggle()
                    },
                    onSend: {
                        guard selectedTextRegion != nil else { return }
                        store.sendRecognizedText(selectedTextValue)
                        resetSelectedText()
                    },
                    onDismiss: {
                        resetSelectedText()
                    }
                )
                .transition(.scale(scale: 0.96).combined(with: .opacity))
            }
        }
        .background(Color.black.ignoresSafeArea())
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                HStack {
                    Spacer()
                    CloudTargetButton {
                        isTargetPickerPresented = true
                    }
                }
                if let toast = store.captureDeliveryToast {
                    CaptureDeliveryToastView(toast: toast)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: store.captureDeliveryToast?.id)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if store.ocrReviewImage != nil {
                OcrReviewControls(
                    regionCount: store.ocrTextRegions.count,
                    onRetake: {
                        resetSelectedText()
                        store.clearOcrReview()
                    },
                    onFinish: {
                        resetSelectedText()
                        store.clearOcrReview()
                        isPresented = false
                    }
                )
            } else {
                VStack(spacing: 6) {
                    if store.activeMode == .ocr {
                        LiveIdentifierStrip(
                            candidates: store.camera.liveTextCandidates,
                            onSend: { candidate in
                                store.sendRecognizedText(candidate.value)
                            }
                        )
                    }

                    CameraSessionControls(
                        activeMode: $store.activeMode,
                        torchEnabled: store.camera.torchEnabled,
                        zoomLabel: store.camera.zoomDisplayLabel,
                        gridVisible: gridVisible,
                        hasLiveTextCandidates: !store.camera.liveTextCandidates.isEmpty,
                        isRecognizingText: store.isRecognizingText,
                        isCaptureEnabled: true,
                        showsModePicker: false,
                        barcodeHint: ScreenshotScenario.current == .captureBarcode ? "Send '883929739929'" : "Point camera at barcode",
                        capturedThumbnails: store.activeMode == .photo ? store.sessionPhotoThumbnails : [],
                        capturedCount: store.sessionPhotoCount,
                        controlRotation: .degrees(store.camera.captureOrientation.controlRotationDegrees),
                        onToggleTorch: {
                            store.camera.setTorchEnabled(!store.camera.torchEnabled)
                        },
                        onZoomOut: {
                            store.camera.adjustZoom(by: -0.25)
                        },
                        onZoomIn: {
                            store.camera.adjustZoom(by: 0.25)
                        },
                        onToggleGrid: {
                            gridVisible.toggle()
                        },
                        onCapture: {
                            Task { await store.capture() }
                        },
                        onFinish: {
                            store.clearOcrReview()
                            isPresented = false
                        }
                    )
                }
            }
        }
        .sheet(isPresented: $isTargetPickerPresented) {
            CloudTargetPickerSheet()
        }
        .onAppear {
            store.activeMode = mode
            store.startSessionPhotoStrip()
            if ScreenshotScenario.current == .captureReviewSend,
               let region = store.ocrTextRegions.first {
                selectTextRegion(region)
            }
        }
        .task {
            await store.camera.requestAccess()
            syncCameraForOcrReview(isReviewingOcr: store.ocrReviewImage != nil)
        }
        .onChange(of: store.ocrReviewImage != nil) { _, isReviewingOcr in
            syncCameraForOcrReview(isReviewingOcr: isReviewingOcr)
            resetSelectedText()
        }
        .task(id: store.captureDeliveryToast?.id) {
            guard let toast = store.captureDeliveryToast else { return }
            try? await Task.sleep(for: .seconds(toast.tone == .failure ? 3 : 2))
            if store.captureDeliveryToast?.id == toast.id {
                store.captureDeliveryToast = nil
            }
        }
        .onDisappear {
            resetSelectedText()
            store.captureDeliveryToast = nil
            store.camera.stop()
        }
    }

    private func syncCameraForOcrReview(isReviewingOcr: Bool) {
        if isReviewingOcr {
            store.camera.stop()
        } else {
            store.camera.start()
        }
    }

    private func selectTextRegion(_ region: RecognizedTextRegion) {
        resetSelectedText()
        selectedTextRegion = region
        cleanupSelectedText(region)
    }

    private func cleanupSelectedText(_ region: RecognizedTextRegion) {
        let requestID = UUID()
        cleanupRequestID = requestID
        isCleaningSelectedText = true
        isShowingRawText = false
        store.statusText = "Cleaning text"
        let context = nearbyOcrContext(for: region)
        Task { @MainActor in
            let result = await OcrTextCleaner.clean(text: region.text, context: context)
            guard cleanupRequestID == requestID,
                  selectedTextRegion?.id == region.id
            else { return }
            selectedCleanedText = result.text
            isCleaningSelectedText = false
            store.statusText = result.usedFoundationModel ? "Text cleaned on device" : "Text cleaned"
        }
    }

    private func resetSelectedText() {
        cleanupRequestID = UUID()
        selectedCleanedText = nil
        selectedTextRegion = nil
        isShowingRawText = false
        isCleaningSelectedText = false
    }

    private func nearbyOcrContext(for region: RecognizedTextRegion) -> String {
        let nearbyRegions = store.ocrTextRegions
            .filter { $0.id != region.id }
            .sorted { lhs, rhs in
                distance(from: region, to: lhs) < distance(from: region, to: rhs)
            }
            .prefix(4)
        let identifierKind = LiveTextIdentifierMatcher.match(region.text)?.kind.rawValue ?? "Text"
        return (["Selected identifier type: \(identifierKind)"] + nearbyRegions.map(\.text))
            .joined(separator: "\n")
    }

    private func distance(from region: RecognizedTextRegion, to other: RecognizedTextRegion) -> CGFloat {
        let dx = region.boundingBox.midX - other.boundingBox.midX
        let dy = region.boundingBox.midY - other.boundingBox.midY
        return (dx * dx) + (dy * dy)
    }

    private var selectedTextValue: String {
        guard let selectedTextRegion else { return "" }
        guard !isShowingRawText, let selectedCleanedText else {
            return selectedTextRegion.text
        }
        return selectedCleanedText
    }

    private var selectedTextPreview: String {
        selectedTextValue
    }
}

private struct CaptureDeliveryToastView: View {
    let toast: CaptureDeliveryToast

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: toast.systemImage)
                .font(.title3.weight(.semibold))
                .foregroundStyle(iconColor)
                .frame(width: 24, height: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(toast.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(toast.message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.2), radius: 18, y: 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(toast.title). \(toast.message)")
    }

    private var iconColor: Color {
        switch toast.tone {
        case .success:
            .green
        case .failure:
            .red
        }
    }
}
