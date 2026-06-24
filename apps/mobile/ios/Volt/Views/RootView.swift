import SwiftUI

struct RootView: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("volt.hasSeenWelcome.v1") private var hasSeenWelcome = false
    @State private var selectedTab = AppSection.scan
    @State private var isWelcomePresented = false
    @State private var opensSessionsAfterWelcome = false
    @State private var isConnectionSheetPresented = false
    @State private var connectionSheetStatus: PairingStatusSheetModel?
    @State private var connectionSheetDetent = RootView.connectionStatusDetent
    @State private var keepsConnectionSheetOpenForSessions = false
    @State private var allowsNextConnectionSheetDismissal = false

    private static let connectionStatusDetent = PresentationDetent.height(112)

    init() {
        _selectedTab = State(initialValue: ScreenshotScenario.current?.initialSection ?? .scan)
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            ScannerView()
                .tabItem { Label("Capture", systemImage: "camera") }
                .tag(AppSection.scan)

            UploadView()
                .tabItem { Label("Upload", systemImage: "square.and.arrow.up") }
                .tag(AppSection.upload)

            DictationView()
                .tabItem { Label("Dictate", systemImage: "mic") }
                .tag(AppSection.dictation)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppSection.settings)
        }
        .sheet(isPresented: $isConnectionSheetPresented, onDismiss: handleConnectionSheetDismiss) {
            if connectionSheetDetent == Self.connectionStatusDetent, let connectionSheetStatus {
                PairingStatusSheet(sheet: connectionSheetStatus) {
                    showSessionsFromConnectionSheet(cancelingConnectionAttempt: true)
                }
                .presentationDetents([Self.connectionStatusDetent, .medium, .large], selection: $connectionSheetDetent)
                .presentationDragIndicator(.visible)
                .onChange(of: connectionSheetDetent) { _, newValue in
                    if newValue != Self.connectionStatusDetent {
                        showSessionsFromConnectionSheet(cancelingConnectionAttempt: connectionSheetStatus.isProgressing)
                    }
                }
            } else {
                PairingSessionsView {
                    beginReconnectFromConnectionSheetSessions()
                }
                    .presentationDetents([.medium, .large], selection: $connectionSheetDetent)
                    .presentationDragIndicator(.visible)
            }
        }
        .fullScreenCover(isPresented: $isWelcomePresented) {
            WelcomeView(
                onSetUpWebSession: {
                    completeWelcome(opensSessions: true)
                },
                onContinue: {
                    completeWelcome(opensSessions: false)
                }
            )
        }
        .onChange(of: selectedTab) { _, newValue in
            applySelectedTab(newValue)
        }
        .onChange(of: isWelcomePresented) { _, newValue in
            guard !newValue, opensSessionsAfterWelcome else { return }
            opensSessionsAfterWelcome = false
            showSessionsFromWelcome()
        }
        .onChange(of: store.connectionStatus) { _, newValue in
            showPairingSheet(for: newValue)
        }
        .task {
            applySelectedTab(selectedTab)
            if ScreenshotScenario.current == .sessions {
                connectionSheetStatus = nil
                connectionSheetDetent = .large
                isConnectionSheetPresented = true
                return
            }
            guard !ScreenshotScenario.isEnabled else { return }
            guard hasSeenWelcome else {
                isWelcomePresented = true
                return
            }
            startAppServices()
        }
        .onChange(of: scenePhase) { _, newValue in
            if newValue == .active && !ScreenshotScenario.isEnabled && hasSeenWelcome {
                store.reconnectToMostRecentPairedSessionIfNeeded()
            }
        }
    }

    private func completeWelcome(opensSessions: Bool) {
        hasSeenWelcome = true
        opensSessionsAfterWelcome = opensSessions
        isWelcomePresented = false

        startAppServices()
    }

    private func startAppServices() {
        store.reconnectToMostRecentPairedSessionIfNeeded()
    }

    private func showSessionsFromWelcome() {
        keepsConnectionSheetOpenForSessions = true
        connectionSheetStatus = nil
        connectionSheetDetent = .medium
        isConnectionSheetPresented = true
    }

    private func applySelectedTab(_ newTab: AppSection) {
        store.selectedSection = newTab
        switch newTab {
        case .scan:
            if store.activeMode == .dictation {
                store.activeMode = .ocr
            }
        case .dictation:
            store.activeMode = .dictation
        case .upload:
            break
        case .settings:
            break
        }
    }

    private func showPairingSheet(for status: ScannerConnectionStatus) {
        switch status {
        case .pairing:
            keepsConnectionSheetOpenForSessions = false
            connectionSheetStatus = PairingStatusSheetModel(
                title: "Pairing with Chrome",
                message: store.peerTarget?.displayText ?? "Trying to open the scanner channel.",
                systemImage: "link",
                isProgressing: true,
                canCancel: true
            )
            connectionSheetDetent = Self.connectionStatusDetent
            isConnectionSheetPresented = true
        case .waitingForChrome:
            keepsConnectionSheetOpenForSessions = false
            connectionSheetStatus = PairingStatusSheetModel(
                title: "Waiting for Chrome",
                message: "Finishing the secure scanner handshake.",
                systemImage: "desktopcomputer",
                isProgressing: true,
                canCancel: true
            )
            connectionSheetDetent = Self.connectionStatusDetent
            isConnectionSheetPresented = true
	        case .connected:
	            keepsConnectionSheetOpenForSessions = false
	            connectionSheetStatus = nil
	            isConnectionSheetPresented = false
	        case .error:
	            keepsConnectionSheetOpenForSessions = false
	            connectionSheetStatus = PairingStatusSheetModel(
	                title: "Pairing failed",
	                message: store.targetHint,
	                systemImage: "exclamationmark.triangle",
	                isProgressing: false,
	                canCancel: false
	            )
	            connectionSheetDetent = Self.connectionStatusDetent
	            isConnectionSheetPresented = true
	        case .idle, .disconnected:
	            if keepsConnectionSheetOpenForSessions {
	                connectionSheetStatus = nil
	                connectionSheetDetent = .medium
                isConnectionSheetPresented = true
            } else {
                connectionSheetStatus = nil
                isConnectionSheetPresented = false
            }
        }
    }

    private func showSessionsFromConnectionSheet(cancelingConnectionAttempt: Bool) {
        keepsConnectionSheetOpenForSessions = true
        connectionSheetStatus = nil
        connectionSheetDetent = .medium
        if cancelingConnectionAttempt {
            store.cancelConnectionAttempt()
        }
        isConnectionSheetPresented = true
    }

    private func handleConnectionSheetDismiss() {
        if allowsNextConnectionSheetDismissal {
            allowsNextConnectionSheetDismissal = false
            resetConnectionSheetPresentation()
            showPairingSheet(for: store.connectionStatus)
            return
        }

        if isConnectionAttemptVisible {
            store.cancelConnectionAttempt()
        }
        resetConnectionSheetPresentation()
    }

    private var isConnectionAttemptVisible: Bool {
        switch store.connectionStatus {
        case .pairing, .waitingForChrome:
            return connectionSheetStatus?.isProgressing == true
        case .idle, .connected, .disconnected, .error:
            return false
        }
    }

    private func resetConnectionSheetPresentation() {
        keepsConnectionSheetOpenForSessions = false
        connectionSheetStatus = nil
        connectionSheetDetent = Self.connectionStatusDetent
    }

    private func beginReconnectFromConnectionSheetSessions() {
        allowsNextConnectionSheetDismissal = true
        keepsConnectionSheetOpenForSessions = false
        connectionSheetStatus = nil
        connectionSheetDetent = Self.connectionStatusDetent
    }
}

enum AppSection: Hashable {
    case scan
    case dictation
    case upload
    case settings
}

struct SettingsView: View {
    @Environment(ScannerStore.self) private var store

    var body: some View {
        @Bindable var store = store

        NavigationStack {
            Form {
                Section("Barcodes") {
                    Picker("Recognized Codes", selection: $store.barcodeRecognitionMode) {
                        ForEach(BarcodeRecognitionMode.allCases) { mode in
                            Text(mode.title)
                                .tag(mode)
                        }
                    }
                    .pickerStyle(.navigationLink)
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                store.selectedSection = .settings
            }
        }
    }
}

private struct PairingStatusSheetModel: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let message: String
    let systemImage: String
    let isProgressing: Bool
    let canCancel: Bool

    init(
        title: String,
        message: String,
        systemImage: String,
        isProgressing: Bool,
        canCancel: Bool
    ) {
        self.title = title
        self.message = message
        self.systemImage = systemImage
        self.isProgressing = isProgressing
        self.canCancel = canCancel
    }
}

private struct PairingStatusSheet: View {
    let sheet: PairingStatusSheetModel
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            if sheet.isProgressing {
                ProgressView()
                    .controlSize(.small)
                    .tint(.primary)
                    .frame(width: 28, height: 28)
            } else {
                Image(systemName: sheet.systemImage)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 28, height: 28)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(sheet.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(sheet.message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            if sheet.canCancel {
                Button(role: .cancel, action: onCancel) {
                    Label("Cancel", systemImage: "xmark")
                        .font(.headline)
                        .foregroundStyle(.red)
                        .labelStyle(.titleAndIcon)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)
                .tint(.red)
                .accessibilityLabel("Cancel reconnect")
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 16)
        .accessibilityElement(children: sheet.canCancel ? .contain : .combine)
        .accessibilityLabel("\(sheet.title). \(sheet.message)")
    }
}

struct ScannerSectionHeader<TrailingAccessory: View>: View {
    @Environment(ScannerStore.self) private var store
    let title: String
    let onConnectionControlTapped: () -> Void
    @ViewBuilder let trailingAccessory: () -> TrailingAccessory

    init(
        title: String,
        onConnectionControlTapped: @escaping () -> Void,
        @ViewBuilder trailingAccessory: @escaping () -> TrailingAccessory
    ) {
        self.title = title
        self.onConnectionControlTapped = onConnectionControlTapped
        self.trailingAccessory = trailingAccessory
    }

    var body: some View {
        ScannerChromeSectionHeader(
            title: title,
            connection: connectionSummary,
            onConnectionControlTapped: onConnectionControlTapped
        ) {
            trailingAccessory()
        }
    }

    private var connectedSessionName: String {
        if let sessionLabel = store.peerTarget?.sessionLabel, !sessionLabel.isEmpty {
            return sessionLabel
        }
        if let savedLabel = savedSessionLabel, !savedLabel.isEmpty {
            return savedLabel
        }
        if let displayName = store.peerTarget?.displayText, !displayName.isEmpty {
            return displayName
        }
        return "Chrome"
    }

    private var savedSessionLabel: String? {
        store.pairedSessions.first { pairedSession in
            pairedSession.browserSessionId == store.peerTarget?.chromeSessionId
                || pairedSession.browserSessionId == store.pairingSession?.sessionId
        }?.displayName
    }

    private var connectionSummary: ScannerConnectionSummary {
        ScannerConnectionSummary(
            isConnected: store.connectionStatus.isConnected,
            isBusy: store.connectionStatus == .pairing || store.connectionStatus == .waitingForChrome,
            title: connectionTitle,
            statusText: store.targetHint
        )
    }

    private var connectionTitle: String {
        if store.connectionStatus.isConnected {
            return connectedSessionName
        }
        if store.connectionStatus == .pairing || store.connectionStatus == .waitingForChrome {
            return "Connecting"
        }
        return "Connect"
    }
}

extension ScannerSectionHeader where TrailingAccessory == EmptyView {
    init(title: String, onConnectionControlTapped: @escaping () -> Void) {
        self.init(title: title, onConnectionControlTapped: onConnectionControlTapped) {
            EmptyView()
        }
    }
}

private struct WelcomeView: View {
    let onSetUpWebSession: () -> Void
    let onContinue: () -> Void

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        VStack(alignment: .leading, spacing: 16) {
                            Image("VoltLogo")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 78, height: 78)
                                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                .accessibilityHidden(true)

                            VStack(alignment: .leading, spacing: 8) {
                                Text("Welcome to Volt")
                                    .font(.largeTitle.bold())
                                    .lineLimit(2)
                                    .minimumScaleFactor(0.82)
                                Text("Thanks for installing. Volt turns your iPhone into a scanner for your computer.")
                                    .font(.body)
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }

                        VStack(spacing: 12) {
                            WelcomeStep(
                                systemImage: "safari",
                                title: "Open Volt on your computer",
                                message: "Use the Volt website or the Chrome extension."
                            )
                            WelcomeStep(
                                systemImage: "qrcode.viewfinder",
                                title: "Scan the pairing QR",
                                message: "Scan the QR from Chrome or the create session page."
                            )
                            WelcomeStep(
                                systemImage: "camera.viewfinder",
                                title: "Send scans from your phone",
                                message: "Capture barcodes, text, voice notes, and photos."
                            )
                        }
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: max(0, geometry.size.height - WelcomeActions.estimatedHeight), alignment: .center)
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    WelcomeActions(onSetUpWebSession: onSetUpWebSession, onContinue: onContinue)
                }
                .background(ScannerTabLayout.background)
            }
            .navigationTitle("Welcome")
            .toolbar(.hidden, for: .navigationBar)
        }
        .interactiveDismissDisabled()
    }
}

private struct WelcomeActions: View {
    static let estimatedHeight: CGFloat = 154

    let onSetUpWebSession: () -> Void
    let onContinue: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Button(action: onContinue) {
                Text("Continue to Volt")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .background(
                        ScannerTabLayout.primaryActionBackground(isEnabled: true),
                        in: RoundedRectangle(cornerRadius: ScannerTabLayout.primaryActionCornerRadius, style: .continuous)
                    )
            }
            .buttonStyle(.plain)

            Button(action: onSetUpWebSession) {
                Label("Set Up Web Session", systemImage: "desktopcomputer")
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 16)
        .background(.bar)
    }
}

private struct WelcomeStep: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: systemImage)
                .font(.headline.weight(.semibold))
                .foregroundStyle(.green)
                .frame(width: 30, height: 30)
                .background(.green.opacity(0.12), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
