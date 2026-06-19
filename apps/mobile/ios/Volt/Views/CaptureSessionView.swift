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
        .safeAreaInset(edge: .top, spacing: 0) {
            if store.ocrReviewImage == nil {
                CameraSessionHeader(onFinish: {
                    store.clearOcrReview()
                    isPresented = false
                })
            }
        }
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
        .onDisappear {
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
