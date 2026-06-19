import SwiftUI

struct CaptureSessionView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var isPresented: Bool
    @State private var gridVisible = true
    @State private var selectedTextRegion: RecognizedTextRegion?
    @State private var isConnectionRecoveryPresented = false

    var body: some View {
        @Bindable var store = store

        ZStack {
            if let reviewImage = store.ocrReviewImage {
                OcrReviewLayer(
                    image: reviewImage,
                    regions: store.ocrTextRegions,
                    selectedRegion: selectedTextRegion,
                    onSelectRegion: { selectedTextRegion = $0 }
                )
                    .ignoresSafeArea()
            } else {
                ScannerCameraLayer(gridVisible: gridVisible)
                    .ignoresSafeArea()
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
                        store.clearOcrReview()
                    },
                    onFinish: {
                        selectedTextRegion = nil
                        store.clearOcrReview()
                        isPresented = false
                    }
                )
            } else {
                CameraSessionControls(
                    activeMode: $store.activeMode,
                    torchEnabled: store.camera.torchEnabled,
                    zoomLabel: store.camera.zoomDisplayLabel,
                    gridVisible: gridVisible,
                    isRecognizingText: store.isRecognizingText,
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
        .confirmationDialog(
            "Extracted Text",
            isPresented: Binding(
                get: { selectedTextRegion != nil },
                set: { isPresented in
                    if !isPresented {
                        selectedTextRegion = nil
                    }
                }
            ),
            titleVisibility: .visible
        ) {
            Button("Send", systemImage: "paperplane.fill") {
                guard let selectedTextRegion else { return }
                store.sendRecognizedText(selectedTextRegion.text)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(selectedTextRegion?.text ?? "")
        }
        .sheet(isPresented: $isConnectionRecoveryPresented) {
            PairingSessionsView()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .onAppear {
            store.activeMode = .ocr
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

    private func handleConnectionStatusChange(_ status: ScannerConnectionStatus) {
        if status.isConnected {
            isConnectionRecoveryPresented = false
            return
        }

        selectedTextRegion = nil
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
