import SwiftUI

struct RootView: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = AppSection.scan
    @State private var isConnectionSheetPresented = false
    @State private var connectionSheetStatus: PairingStatusSheetModel?
    @State private var connectionSheetDetent = RootView.connectionStatusDetent
    @State private var keepsConnectionSheetOpenForSessions = false
    @State private var allowsNextConnectionSheetDismissal = false

    private static let connectionStatusDetent = PresentationDetent.height(112)

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
        .onChange(of: selectedTab) { _, newValue in
            applySelectedTab(newValue)
        }
        .onChange(of: store.connectionStatus) { _, newValue in
            showPairingSheet(for: newValue)
        }
        .task {
            await store.camera.requestAccess()
            store.reconnectToMostRecentPairedSessionIfNeeded()
            applySelectedTab(selectedTab)
        }
        .onChange(of: scenePhase) { _, newValue in
            if newValue == .active {
                store.reconnectToMostRecentPairedSessionIfNeeded()
            }
        }
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
        case .idle, .disconnected, .error:
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

enum ScannerTabLayout {
    static let stackSpacing: CGFloat = 18
    static let contentPadding: CGFloat = 20
    static let topPadding: CGFloat = 8
    static let bottomAccessoryContentPadding: CGFloat = 84
    static let primaryActionCornerRadius: CGFloat = 22
    static let disabledPrimaryActionOpacity = 0.68

    static var background: Color {
        Color(.systemGroupedBackground)
    }

    static func primaryActionBackground(isEnabled: Bool) -> Color {
        isEnabled ? .green : .gray
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
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title)
                .font(.largeTitle.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .frame(maxWidth: .infinity, alignment: .leading)

            trailingAccessory()

            connectionControl
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var connectionControl: some View {
        if store.connectionStatus.isConnected {
            Button {
                onConnectionControlTapped()
            } label: {
                Text(connectedSessionName)
                    .font(.headline)
                    .foregroundStyle(.green)
                    .lineLimit(1)
                    .minimumScaleFactor(0.76)
                    .padding(.horizontal, 18)
                    .frame(minHeight: 44)
                    .background(.regularMaterial, in: Capsule())
            }
            .accessibilityLabel("Connected to \(connectedSessionName). Open sessions.")
        } else {
            Button {
                onConnectionControlTapped()
            } label: {
                Label("Connect", systemImage: "desktopcomputer")
                    .font(.headline)
                    .foregroundStyle(statusColor)
                    .lineLimit(1)
                    .padding(.horizontal, 18)
                    .frame(minHeight: 44)
                    .background(.regularMaterial, in: Capsule())
            }
            .accessibilityLabel("Connect. Open sessions.")
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

    private var statusColor: Color {
        switch store.connectionStatus {
        case .connected:
            .green
        case .pairing, .waitingForChrome:
            .orange
        case .error:
            .red
        case .idle, .disconnected:
            .secondary
        }
    }
}

extension ScannerSectionHeader where TrailingAccessory == EmptyView {
    init(title: String, onConnectionControlTapped: @escaping () -> Void) {
        self.init(title: title, onConnectionControlTapped: onConnectionControlTapped) {
            EmptyView()
        }
    }
}
