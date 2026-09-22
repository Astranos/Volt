import SwiftUI

struct ClipRootView: View {
    @Bindable var store: ClipScannerStore
    @State private var isConnectionSheetPresented = false
    @State private var isPairingScannerPresented = false
    @State private var requestedSessionBatchId: String?

    var body: some View {
        ClipCaptureView(store: store, mode: .ocr, requestedSessionBatchId: $requestedSessionBatchId) {
            handleConnectButtonTapped()
        }
        .sheet(isPresented: $isConnectionSheetPresented) {
            ClipConnectionSheet(
                store: store,
                onDisconnect: {
                    isConnectionSheetPresented = false
                    store.disconnect()
                },
                onScanQRCode: {
                    isConnectionSheetPresented = false
                    if store.isConnected {
                        store.disconnect()
                    }
                    showPairingScanner()
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .presentationBackground(Color(uiColor: .systemBackground))
            .interactiveDismissDisabled(store.isPairing)
        }
        .fullScreenCover(isPresented: $isPairingScannerPresented) {
            ClipPairingScannerView(store: store) {
                isPairingScannerPresented = false
            }
        }
        .onChange(of: store.pairingFailureMessage) { _, message in
            if message != nil && !store.isConnected {
                isConnectionSheetPresented = true
            }
        }
        .onChange(of: store.isPairing) { _, isPairing in
            if isPairing {
                isConnectionSheetPresented = true
            }
        }
        .onChange(of: store.isConnected) { _, isConnected in
            if isConnected {
                isConnectionSheetPresented = false
            }
        }
    }

    private func handleConnectButtonTapped() {
        isConnectionSheetPresented = true
    }

    private func showPairingScanner() {
        isConnectionSheetPresented = false
        isPairingScannerPresented = true
    }
}
