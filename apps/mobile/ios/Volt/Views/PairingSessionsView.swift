import SwiftUI

struct PairingSessionsView: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var isPairingScannerPresented = false
    let onReconnectStarted: () -> Void
    let onPairingCodeAccepted: () -> Void

    init(
        onReconnectStarted: @escaping () -> Void = {},
        onPairingCodeAccepted: @escaping () -> Void = {}
    ) {
        self.onReconnectStarted = onReconnectStarted
        self.onPairingCodeAccepted = onPairingCodeAccepted
    }

    var body: some View {
        NavigationStack {
            Group {
                if store.visiblePairingSessions.isEmpty {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            sessionsHeader
                            webSessionSetup
                            scanPairingCTA
                        }
                        .padding(ScannerTabLayout.contentPadding)
                        .padding(.top, ScannerTabLayout.topPadding)
                        .padding(.bottom, 24)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                            sessionsHeader
                            Text("Previously Paired")
                                .font(.headline)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 2)
                        }
                        .padding(ScannerTabLayout.contentPadding)
                        .padding(.top, ScannerTabLayout.topPadding)

                        pairedSessionsList
                    }
                }
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Sessions")
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $isPairingScannerPresented) {
                PairingScanSessionView(isPresented: $isPairingScannerPresented) {
                    onPairingCodeAccepted()
                }
            }
            .onAppear {
                store.pruneExpiredPairedSessions()
            }
        }
    }

    private var sessionsHeader: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("Sessions")
                .font(.largeTitle.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .frame(maxWidth: .infinity, alignment: .leading)

            if !store.visiblePairingSessions.isEmpty {
                Button {
                    handleHeaderPairingAction()
                } label: {
                    Label(pairingButtonTitle, systemImage: pairingButtonSystemImage)
                        .font(.headline)
                        .foregroundStyle(pairingButtonColor)
                        .lineLimit(1)
                        .padding(.horizontal, 18)
                        .frame(minHeight: 44)
                        .background(.regularMaterial, in: Capsule())
                }
                .accessibilityLabel(pairingButtonAccessibilityLabel)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var webSessionSetup: some View {
        PairingSessionSetupContent()
    }

    private var scanPairingCTA: some View {
        Button(action: startPairingScan) {
            Label("Scan Computer QR", systemImage: "qrcode.viewfinder")
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(
                    ScannerTabLayout.primaryActionBackground(isEnabled: true),
                    in: RoundedRectangle(cornerRadius: ScannerTabLayout.primaryActionCornerRadius, style: .continuous)
                )
        }
        .buttonStyle(.plain)
    }

    private func startPairingScan() {
        store.activeMode = .barcode
        isPairingScannerPresented = true
    }

    private func handleHeaderPairingAction() {
        if store.connectionStatus.isConnected {
            store.disconnectFromCurrentSession()
            return
        }

        startPairingScan()
    }

    private var pairingButtonTitle: String {
        store.connectionStatus.isConnected ? "Disconnect" : "Pair"
    }

    private var pairingButtonSystemImage: String {
        store.connectionStatus.isConnected ? "link.badge.minus" : "qrcode.viewfinder"
    }

    private var pairingButtonColor: Color {
        store.connectionStatus.isConnected ? .red : .green
    }

    private var pairingButtonAccessibilityLabel: String {
        store.connectionStatus.isConnected ? "Disconnect from browser" : "Pair with QR code"
    }

    private var pairedSessionsList: some View {
        List {
            ForEach(store.visiblePairingSessions) { session in
                Button {
                    handleSessionTap(session)
                } label: {
                    PairedSessionRow(session: session, canReconnect: store.canReconnect(to: session))
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 5, leading: ScannerTabLayout.contentPadding, bottom: 5, trailing: ScannerTabLayout.contentPadding))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .contextMenu {
                    Button("Forget", systemImage: "trash", role: .destructive) {
                        store.forgetVisibleSession(session)
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button("Forget", systemImage: "trash", role: .destructive) {
                        store.forgetVisibleSession(session)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(ScannerTabLayout.background)
    }

    private func handleSessionTap(_ session: PairedScannerSession) {
        if store.canReconnect(to: session) {
            onReconnectStarted()
            store.reconnect(to: session)
            return
        }

        if store.connectionStatus.isConnected,
           session.browserSessionId == store.peerTarget?.chromeSessionId {
            dismiss()
            return
        }

        // Recent web-only sessions are informational; use the Pair button to scan a fresh QR.
    }

}

struct PairingScanSessionView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var isPresented: Bool
    let onPairingCodeAccepted: () -> Void
    @State private var previousBarcodeRecognitionMode: BarcodeRecognitionMode?

    init(isPresented: Binding<Bool>, onPairingCodeAccepted: @escaping () -> Void = {}) {
        self._isPresented = isPresented
        self.onPairingCodeAccepted = onPairingCodeAccepted
    }

    var body: some View {
        ZStack {
            ScannerCameraLayer(guideVisible: false)
                .ignoresSafeArea()
        }
        .background(.black)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            PairingScanControls(
                statusText: store.statusText,
                statusDetail: PairingScanStatusMessage.detail(
                    connectionStatus: store.connectionStatus,
                    isCodeDetected: store.camera.detectedBarcodeBounds != nil
                ),
                onFinish: {
                    isPresented = false
                }
            )
        }
        .onAppear {
            previousBarcodeRecognitionMode = store.camera.barcodeRecognitionMode
            store.activeMode = .barcode
            store.camera.updateBarcodeRecognitionMode(.qr)
            store.camera.clearDetectedBarcode()
        }
        .task {
            await store.camera.requestAccess()
            store.camera.start()
        }
        .onDisappear {
            if let previousBarcodeRecognitionMode {
                store.camera.updateBarcodeRecognitionMode(previousBarcodeRecognitionMode)
                self.previousBarcodeRecognitionMode = nil
            }
            store.camera.stop()
            if store.activeMode == .barcode {
                store.activeMode = .ocr
            }
        }
        .onChange(of: store.camera.lastBarcode) { _, _ in
            if store.pairScannedBarcodeIfNeeded() {
                onPairingCodeAccepted()
                isPresented = false
            }
        }
        .onChange(of: store.connectionStatus) { _, newValue in
            if newValue.isConnected {
                isPresented = false
            }
        }
    }
}

private enum PairingScanStatusMessage {
    static func detail(connectionStatus: ScannerConnectionStatus, isCodeDetected: Bool) -> String {
        switch connectionStatus {
        case .idle, .disconnected:
            isCodeDetected ? "Hold steady while the QR is read." : "Center the browser pairing QR in the frame."
        case .pairing:
            "QR accepted. Starting the pairing request."
        case .waitingForChrome:
            "Chrome received the request and is creating the connection."
        case .connected:
            "Ready to send captures back to the browser."
        case .error:
            "Try refreshing the pairing QR and scan it again."
        }
    }
}

private struct PairedSessionRow: View {
    let session: PairedScannerSession
    let canReconnect: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "desktopcomputer")
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                Text(session.displayName)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(session.lastConnectedAt, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(session.browserSessionId)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if !canReconnect {
                    Text("Use Pair to reconnect")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            Image(systemName: canReconnect ? "chevron.right" : "info.circle")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}
