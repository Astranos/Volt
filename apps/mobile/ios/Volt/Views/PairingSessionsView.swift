import SwiftUI

struct PairingSessionsView: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var isPairingScannerPresented = false
    let onReconnectStarted: () -> Void
    private let webScannerURL = URL(string: "https://volt-scanner.vercel.app/create-session")!

    init(onReconnectStarted: @escaping () -> Void = {}) {
        self.onReconnectStarted = onReconnectStarted
    }

    var body: some View {
        NavigationStack {
            Group {
                if store.pairedSessions.isEmpty {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            sessionsHeader
                            webSessionSetup
                        }
                        .padding(ScannerTabLayout.contentPadding)
                        .padding(.top, ScannerTabLayout.topPadding)
                        .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
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
                PairingScanSessionView(isPresented: $isPairingScannerPresented)
            }
            .onAppear {
                store.pruneExpiredPairedSessions()
            }
            .overlay(alignment: .bottom) {
                ScanChromeQRAccessory(onScan: startPairingScan)
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

            if !store.pairedSessions.isEmpty {
                Button {
                    if store.connectionStatus.isConnected {
                        store.unpair()
                    } else {
                        startPairingScan()
                    }
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
        VStack(alignment: .leading, spacing: 16) {
            Text("Scan the QR code from the Chrome extension, or open the create session page on your computer. This iPhone will connect to that browser session.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                SessionSetupStep(
                    systemImage: "desktopcomputer",
                    title: "Open Volt on your computer",
                    detail: "Use the Chrome extension side panel, or go to volt-scanner.vercel.app/create-session."
                )
                SessionSetupStep(
                    systemImage: "qrcode",
                    title: "Show the pairing QR",
                    detail: "Start pairing in Chrome or on the create session page."
                )
                SessionSetupStep(
                    systemImage: "iphone",
                    title: "Scan the QR with this iPhone",
                    detail: "Tap the green button below."
                )
            }

            Button {
                openURL(webScannerURL)
            } label: {
                Label("Open Create Session Page", systemImage: "safari")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.green)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(.green.opacity(0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func startPairingScan() {
        store.activeMode = .barcode
        isPairingScannerPresented = true
    }

    private var pairingButtonTitle: String {
        store.connectionStatus.isConnected ? "Unpair" : "Pair"
    }

    private var pairingButtonSystemImage: String {
        store.connectionStatus.isConnected ? "xmark.circle.fill" : "qrcode.viewfinder"
    }

    private var pairingButtonColor: Color {
        store.connectionStatus.isConnected ? .red : .secondary
    }

    private var pairingButtonAccessibilityLabel: String {
        store.connectionStatus.isConnected ? "Unpair from browser" : "Pair with browser"
    }

    private var pairedSessionsList: some View {
        List {
            ForEach(store.pairedSessions) { session in
                Button {
                    onReconnectStarted()
                    store.reconnect(to: session)
                    dismiss()
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
        .safeAreaPadding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
    }

}

private struct ScanChromeQRAccessory: View {
    let onScan: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onScan) {
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
        .ignoresSafeArea(edges: .bottom)
        .padding(.horizontal)
        .padding(.top, 10)
        .background {
            Rectangle()
                .fill(.bar)
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

private struct SessionSetupStep: View {
    let systemImage: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.headline.weight(.semibold))
                .foregroundStyle(.green)
                .frame(width: 32, height: 32)
                .background(.green.opacity(0.10), in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PairingScanSessionView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var isPresented: Bool
    @State private var previousBarcodeRecognitionMode: BarcodeRecognitionMode?

    var body: some View {
        ZStack {
            ScannerCameraLayer(guideVisible: false)
                .ignoresSafeArea()
        }
        .background(.black)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            PairingScanControls(
                statusText: store.statusText,
                connectionStatus: store.connectionStatus,
                isCodeDetected: store.camera.detectedBarcodeBounds != nil,
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
    let connectionStatus: ScannerConnectionStatus
    let isCodeDetected: Bool
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Label("Scan Pairing QR", systemImage: "qrcode.viewfinder")
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)

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
