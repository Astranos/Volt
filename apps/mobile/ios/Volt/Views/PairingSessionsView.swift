import SwiftUI

struct PairingSessionsView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isPairingScannerPresented = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ScannerSectionHeader(title: "Sessions") {
                        isPairingScannerPresented = true
                    }

                    scanChromeQRButton

                    if store.pairedSessions.isEmpty {
                        ContentUnavailableView(
                            "No Paired Sessions",
                            systemImage: "link",
                            description: Text("Pair once from the Chrome QR code, then reconnect to that computer from here.")
                        )
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 34)
                        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    } else {
                        Text("Previously Paired")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 2)
                    }
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)

                if !store.pairedSessions.isEmpty {
                    pairedSessionsList
                }
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Sessions")
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $isPairingScannerPresented) {
                PairingScanSessionView(isPresented: $isPairingScannerPresented)
            }
            .onAppear {
                store.pruneExpiredPairedSessions()
            }
        }
    }

    private var pairedSessionsList: some View {
        List {
            ForEach(store.pairedSessions) { session in
                Button {
                    store.reconnect(to: session)
                } label: {
                    PairedSessionRow(session: session)
                        .padding(14)
                        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 5, leading: ScannerTabLayout.contentPadding, bottom: 5, trailing: ScannerTabLayout.contentPadding))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .contextMenu {
                    Button("Forget", systemImage: "trash", role: .destructive) {
                        store.removePairedSession(session)
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button("Forget", systemImage: "trash", role: .destructive) {
                        store.removePairedSession(session)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(ScannerTabLayout.background)
    }

    private var scanChromeQRButton: some View {
        Button {
            store.activeMode = .barcode
            isPairingScannerPresented = true
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 28, weight: .semibold))
                    .frame(width: 54, height: 54)
                    .background(.white.opacity(0.18), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text("Scan Chrome QR")
                        .font(.title3.weight(.bold))
                    Text("Open the camera to add a Chrome session.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.78))
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.headline.weight(.semibold))
            }
            .foregroundStyle(.white)
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(.green, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct PairingScanSessionView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var isPresented: Bool

    var body: some View {
        ZStack {
            ScannerCameraLayer(
                guideVisible: false,
                barcodeDetectionLabel: PairingScanStatusMessage.detail(
                    connectionStatus: store.connectionStatus,
                    isCodeDetected: store.camera.detectedBarcodeBounds != nil
                )
            )
                .ignoresSafeArea()
        }
        .background(.black)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            PairingScanControls(
                statusText: store.statusText,
                targetHint: store.targetHint,
                connectionStatus: store.connectionStatus,
                isCodeDetected: store.camera.detectedBarcodeBounds != nil,
                onFinish: {
                    isPresented = false
                }
            )
        }
        .onAppear {
            store.activeMode = .barcode
            store.camera.clearDetectedBarcode()
            store.camera.start()
        }
        .onDisappear {
            store.camera.stop()
            if store.activeMode == .barcode {
                store.activeMode = .ocr
            }
        }
        .onChange(of: store.camera.lastBarcode) { _, _ in
            if store.pairScannedBarcodeIfNeeded() {
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

private struct PairingScanControls: View {
    let statusText: String
    let targetHint: String
    let connectionStatus: ScannerConnectionStatus
    let isCodeDetected: Bool
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Label("Scan Chrome QR", systemImage: "qrcode.viewfinder")
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)

            Text(targetHint)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.76))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: .infinity)

            HStack(spacing: 8) {
                PairingProgressStep(
                    title: "Find",
                    systemImage: isCodeDetected ? "viewfinder.circle.fill" : "viewfinder.circle",
                    isActive: isCodeDetected,
                    isComplete: isCodeDetected
                )
                PairingProgressStep(
                    title: "Read",
                    systemImage: hasReadCode ? "qrcode.viewfinder" : "qrcode",
                    isActive: hasReadCode,
                    isComplete: hasReadCode
                )
                PairingProgressStep(
                    title: "Connect",
                    systemImage: connectionSymbol,
                    isActive: isConnecting || connectionStatus.isConnected,
                    isComplete: connectionStatus.isConnected
                )
            }

            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(statusText)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                    Text(statusDetail)
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.66))
                        .lineLimit(2)
                }

                Spacer(minLength: 12)

                Button("Finish", systemImage: "xmark") {
                    onFinish()
                }
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .frame(minHeight: 44)
                .padding(.horizontal, 14)
                .background(.black.opacity(0.54), in: Capsule())
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 22)
        .background {
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.78), .black.opacity(0.94)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        }
    }

    private var hasReadCode: Bool {
        switch connectionStatus {
        case .pairing, .waitingForChrome, .connected:
            true
        case .idle, .disconnected, .error:
            isCodeDetected && statusText != "Not paired"
        }
    }

    private var isConnecting: Bool {
        switch connectionStatus {
        case .pairing, .waitingForChrome:
            true
        case .idle, .connected, .disconnected, .error:
            false
        }
    }

    private var connectionSymbol: String {
        switch connectionStatus {
        case .connected:
            "checkmark.circle.fill"
        case .error:
            "exclamationmark.triangle.fill"
        case .pairing, .waitingForChrome:
            "arrow.triangle.2.circlepath.circle.fill"
        case .idle, .disconnected:
            "link.circle"
        }
    }

    private var statusDetail: String {
        PairingScanStatusMessage.detail(
            connectionStatus: connectionStatus,
            isCodeDetected: isCodeDetected
        )
    }
}

private enum PairingScanStatusMessage {
    static func detail(connectionStatus: ScannerConnectionStatus, isCodeDetected: Bool) -> String {
        switch connectionStatus {
        case .idle, .disconnected:
            isCodeDetected ? "Hold steady while the QR is read." : "Center the Chrome pairing QR in the frame."
        case .pairing:
            "QR accepted. Starting the pairing request."
        case .waitingForChrome:
            "Chrome received the request and is creating the connection."
        case .connected:
            "Ready to send captures back to the browser."
        case .error:
            "Try refreshing the Chrome QR and scan it again."
        }
    }
}

private struct PairingProgressStep: View {
    let title: String
    let systemImage: String
    let isActive: Bool
    let isComplete: Bool

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(isActive ? .white : .white.opacity(0.52))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity, minHeight: 34)
            .padding(.horizontal, 8)
            .background(.white.opacity(isActive ? 0.18 : 0.08), in: Capsule())
            .overlay {
                Capsule().stroke(.white.opacity(isComplete ? 0.45 : 0.12), lineWidth: 1)
            }
            .accessibilityLabel("\(title) \(isComplete ? "complete" : isActive ? "active" : "pending")")
    }
}

private struct PairedSessionRow: View {
    let session: PairedScannerSession

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
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}
