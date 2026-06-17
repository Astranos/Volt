import SwiftUI

struct RootView: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = AppSection.scan
    @State private var pairingToast: PairingStatusToastModel?

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

            PairingSessionsView()
                .tabItem { Label("Sessions", systemImage: "link") }
                .tag(AppSection.sessions)
        }
        .overlay(alignment: .top) {
            if let pairingToast {
                PairingStatusToast(toast: pairingToast, action: pairingToast.actionTitle == nil ? nil : {
                    store.cancelReconnect()
                    self.pairingToast = nil
                })
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: pairingToast?.id)
        .onChange(of: selectedTab) { _, newValue in
            applySelectedTab(newValue)
        }
        .onChange(of: store.connectionStatus) { _, newValue in
            showPairingToast(for: newValue)
        }
        .task(id: pairingToast?.id) {
            guard let toast = pairingToast, let duration = toast.duration else { return }
            try? await Task.sleep(for: duration)
            if pairingToast?.id == toast.id {
                pairingToast = nil
            }
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
        case .sessions:
            break
        case .dictation:
            store.activeMode = .dictation
        case .upload:
            break
        }
    }

    private func showPairingToast(for status: ScannerConnectionStatus) {
        switch status {
        case .pairing:
            pairingToast = PairingStatusToastModel(
                title: "Pairing with Chrome",
                message: store.peerTarget?.displayText ?? "Trying to open the scanner channel.",
                systemImage: "link",
                showsProgress: true,
                duration: nil,
                actionTitle: store.canCancelReconnect ? "Cancel" : nil,
                actionSystemImage: store.canCancelReconnect ? "xmark" : nil
            )
        case .waitingForChrome:
            pairingToast = PairingStatusToastModel(
                title: "Waiting for Chrome",
                message: "Finishing the secure scanner handshake.",
                systemImage: "desktopcomputer",
                showsProgress: true,
                duration: nil,
                actionTitle: store.canCancelReconnect ? "Cancel" : nil,
                actionSystemImage: store.canCancelReconnect ? "xmark" : nil
            )
        case .connected:
            pairingToast = PairingStatusToastModel(
                title: "Connected to Chrome",
                message: store.peerTarget?.displayText ?? "Ready to send captures.",
                systemImage: "checkmark.circle.fill",
                showsProgress: false,
                duration: .seconds(2)
            )
        case .error(let message):
            pairingToast = PairingStatusToastModel(
                title: "Pairing failed",
                message: message,
                systemImage: "exclamationmark.triangle.fill",
                showsProgress: false,
                duration: .seconds(4)
            )
        case .idle, .disconnected:
            pairingToast = nil
        }
    }
}

enum AppSection: Hashable {
    case scan
    case sessions
    case dictation
    case upload
}

private struct PairingStatusToastModel: Equatable {
    let id = UUID()
    let title: String
    let message: String
    let systemImage: String
    let showsProgress: Bool
    let duration: Duration?
    let actionTitle: String?
    let actionSystemImage: String?

    init(
        title: String,
        message: String,
        systemImage: String,
        showsProgress: Bool,
        duration: Duration?,
        actionTitle: String? = nil,
        actionSystemImage: String? = nil
    ) {
        self.title = title
        self.message = message
        self.systemImage = systemImage
        self.showsProgress = showsProgress
        self.duration = duration
        self.actionTitle = actionTitle
        self.actionSystemImage = actionSystemImage
    }
}

private struct PairingStatusToast: View {
    let toast: PairingStatusToastModel
    let action: (() -> Void)?

    var body: some View {
        HStack(spacing: 12) {
            if toast.showsProgress {
                ProgressView()
                    .controlSize(.small)
                    .tint(.primary)
                    .frame(width: 24, height: 24)
            } else {
                Image(systemName: toast.systemImage)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(iconStyle)
                    .frame(width: 24, height: 24)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(toast.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(toast.message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            if let actionTitle = toast.actionTitle, let action {
                Button(action: action) {
                    Label(actionTitle, systemImage: toast.actionSystemImage ?? "xmark")
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .accessibilityLabel(actionTitle)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.16), radius: 18, y: 8)
        .accessibilityElement(children: action == nil ? .combine : .contain)
        .accessibilityLabel("\(toast.title). \(toast.message)")
    }

    private var iconStyle: Color {
        if toast.systemImage == "checkmark.circle.fill" {
            return .green
        }
        if toast.systemImage == "exclamationmark.triangle.fill" {
            return .orange
        }
        return .primary
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

struct ScannerSectionHeader: View {
    @Environment(ScannerStore.self) private var store
    let title: String
    let onPair: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(title)
                .font(.largeTitle.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .frame(maxWidth: .infinity, alignment: .leading)

            connectionControl
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var connectionControl: some View {
        if store.connectionStatus.isConnected {
            Menu {
                Section("Connected Session") {
                    Text(connectedSessionName)
                    Text(connectedSessionId)
                }

                Text(store.targetHint)

                Button("Unpair", systemImage: "link.badge.minus") {
                    store.unpair()
                }
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
            .accessibilityLabel("Connected to \(connectedSessionName). \(store.targetHint)")
        } else {
            Button {
                onPair()
            } label: {
                Label("Pair", systemImage: "qrcode.viewfinder")
                    .font(.headline)
                    .foregroundStyle(statusColor)
                    .lineLimit(1)
                    .padding(.horizontal, 18)
                    .frame(minHeight: 44)
                    .background(.regularMaterial, in: Capsule())
            }
            .accessibilityLabel("Pair. \(store.targetHint)")
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

    private var connectedSessionId: String {
        if let sessionId = store.peerTarget?.chromeSessionId, !sessionId.isEmpty {
            return sessionId
        }
        if let sessionId = store.pairingSession?.sessionId, !sessionId.isEmpty {
            return sessionId
        }
        return "Unknown session id"
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
