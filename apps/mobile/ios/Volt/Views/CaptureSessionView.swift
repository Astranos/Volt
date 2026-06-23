import SwiftUI

struct CaptureSessionView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var isPresented: Bool
    @State private var gridVisible = true
    @State private var selectedTextRegion: RecognizedTextRegion?
    @State private var selectedCleanedText: String?
    @State private var isCleaningSelectedText = false
    @State private var isConnectionRecoveryPresented = false

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
                ScannerCameraLayer(gridVisible: gridVisible)
                    .ignoresSafeArea()
            }

            if selectedTextRegion != nil {
                ExtractedTextActionCard(
                    text: selectedTextPreview,
                    isCleaning: isCleaningSelectedText,
                    onCleanup: {
                        guard let selectedTextRegion else { return }
                        cleanupSelectedText(selectedTextRegion)
                    },
                    onSend: {
                        guard let selectedTextRegion else { return }
                        store.sendRecognizedText(selectedCleanedText ?? selectedTextRegion.text)
                        self.selectedTextRegion = nil
                    },
                    onDismiss: {
                        selectedTextRegion = nil
                        selectedCleanedText = nil
                    }
                )
                .transition(.scale(scale: 0.96).combined(with: .opacity))
            }
        }
        .background(.black)
        .overlay(alignment: .top) {
            if let toast = store.captureDeliveryToast {
                CaptureDeliveryToastView(toast: toast)
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: store.captureDeliveryToast?.id)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if store.ocrReviewImage != nil {
                OcrReviewControls(
                    regionCount: store.ocrTextRegions.count,
                    onRetake: {
                        selectedTextRegion = nil
                        selectedCleanedText = nil
                        store.clearOcrReview()
                    },
                    onFinish: {
                        selectedTextRegion = nil
                        selectedCleanedText = nil
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
                        barcodeHint: ScreenshotScenario.current == .captureBarcode ? "Send '883929739929'" : "Point camera at barcode",
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
        .sheet(isPresented: $isConnectionRecoveryPresented) {
            PairingSessionsView()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .onAppear {
            store.activeMode = ScreenshotScenario.current?.initialCaptureMode ?? .ocr
            if ScreenshotScenario.current == .captureReviewSend,
               let region = store.ocrTextRegions.first {
                selectedTextRegion = region
            }
        }
        .task {
            await store.camera.requestAccess()
            syncCameraForOcrReview(isReviewingOcr: store.ocrReviewImage != nil)
        }
        .onChange(of: store.ocrReviewImage != nil) { _, isReviewingOcr in
            syncCameraForOcrReview(isReviewingOcr: isReviewingOcr)
        }
        .onChange(of: store.connectionStatus) { _, status in
            handleConnectionStatusChange(status)
        }
        .task(id: store.captureDeliveryToast?.id) {
            guard let toast = store.captureDeliveryToast else { return }
            try? await Task.sleep(for: .seconds(toast.tone == .failure ? 3 : 2))
            if store.captureDeliveryToast?.id == toast.id {
                store.captureDeliveryToast = nil
            }
        }
        .onDisappear {
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
        selectedCleanedText = nil
        selectedTextRegion = region
    }

    private func cleanupSelectedText(_ region: RecognizedTextRegion) {
        isCleaningSelectedText = true
        store.statusText = "Cleaning text"
        Task {
            let result = await OcrTextCleaner.clean(text: region.text)
            selectedCleanedText = result.text
            selectedTextRegion = region
            isCleaningSelectedText = false
            store.statusText = result.usedFoundationModel ? "Text cleaned on device" : "Text cleaned"
        }
    }

    private func handleConnectionStatusChange(_ status: ScannerConnectionStatus) {
        if status.isConnected {
            isConnectionRecoveryPresented = false
            return
        }

        selectedTextRegion = nil
        selectedCleanedText = nil
        store.clearOcrReview()

        switch status {
        case .idle, .disconnected, .error:
            isConnectionRecoveryPresented = !store.recoverMostRecentPairedSession()
        case .pairing, .waitingForChrome:
            isConnectionRecoveryPresented = false
        case .connected:
            break
        }
    }

    private var selectedTextPreview: String {
        guard let selectedTextRegion else { return "" }
        guard let selectedCleanedText, selectedCleanedText != selectedTextRegion.text else {
            return selectedTextRegion.text
        }
        return """
        Cleaned
        \(selectedCleanedText)

        Original
        \(selectedTextRegion.text)
        """
    }
}

private struct ExtractedTextActionCard: View {
    let text: String
    let isCleaning: Bool
    let onCleanup: () -> Void
    let onSend: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Extracted Text")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.black)

                    Text(text)
                        .font(.title3)
                        .foregroundStyle(.black.opacity(0.62))
                        .lineLimit(3)
                        .minimumScaleFactor(0.78)
                }

                Spacer(minLength: 0)

                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.black.opacity(0.68))
                        .frame(width: 34, height: 34)
                        .background(.black.opacity(0.1), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }

            VStack(spacing: 12) {
                Button(action: onCleanup) {
                    Label(isCleaning ? "Cleaning..." : "Cleanup", systemImage: "wand.and.sparkles")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .frame(height: 64)
                        .background(.black.opacity(0.12), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isCleaning)

                Button(action: onSend) {
                    Label("Send", systemImage: "paperplane.fill")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 64)
                        .background(Color.green, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 28)
        .frame(width: 340)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 36, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 36, style: .continuous)
                .stroke(.white.opacity(0.42), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.22), radius: 28, y: 16)
        .accessibilityElement(children: .contain)
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
