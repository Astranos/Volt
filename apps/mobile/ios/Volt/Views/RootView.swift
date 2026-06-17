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

            DictationView()
                .tabItem { Label("Dictate", systemImage: "mic") }
                .tag(AppSection.dictation)

            UploadView()
                .tabItem { Label("Upload", systemImage: "square.and.arrow.up") }
                .tag(AppSection.upload)

            PairingSessionsView()
                .tabItem { Label("Sessions", systemImage: "link") }
                .tag(AppSection.sessions)
        }
        .overlay(alignment: .top) {
            if let pairingToast {
                PairingStatusToast(toast: pairingToast)
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: pairingToast?.id)
        .onChange(of: selectedTab) { oldValue, newValue in
            applySelectedTab(from: oldValue, to: newValue)
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
            applySelectedTab(from: nil, to: selectedTab)
        }
        .onChange(of: scenePhase) { _, newValue in
            if newValue == .active {
                store.reconnectToMostRecentPairedSessionIfNeeded()
            }
        }
    }

    private func applySelectedTab(from oldTab: AppSection?, to newTab: AppSection) {
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

        if newTab == .scan {
            if oldTab != .scan {
                store.camera.start()
            }
        } else if oldTab == .scan {
            store.camera.stop()
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
                duration: nil
            )
        case .waitingForChrome:
            pairingToast = PairingStatusToastModel(
                title: "Waiting for Chrome",
                message: "Finishing the secure scanner handshake.",
                systemImage: "desktopcomputer",
                showsProgress: true,
                duration: nil
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

private enum AppSection: Hashable {
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
}

private struct PairingStatusToast: View {
    let toast: PairingStatusToastModel

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
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.16), radius: 18, y: 8)
        .accessibilityElement(children: .combine)
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

struct ScannerConnectionToolbar: ToolbarContent {
    @Environment(ScannerStore.self) private var store

    var body: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            if store.connectionStatus.isConnected {
                ConnectedSessionHeader(name: connectedSessionName)
            }
        }

        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                if store.connectionStatus.isConnected {
                    Section("Connected Session") {
                        Text(connectedSessionName)
                        Text(connectedSessionId)
                    }
                }

                Text(store.targetHint)

                if store.connectionStatus.isConnected {
                    Button("Unpair", systemImage: "link.badge.minus") {
                        store.unpair()
                    }
                }
            } label: {
                Label(statusLabel, systemImage: statusSymbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(statusColor)
                    .lineLimit(1)
            }
            .accessibilityLabel("\(statusLabel). \(store.targetHint)")
        }
    }

    private var statusLabel: String {
        if store.connectionStatus.isConnected {
            return "Connected"
        }
        return store.statusText
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

    private var statusSymbol: String {
        switch store.connectionStatus {
        case .connected:
            "checkmark.circle.fill"
        case .pairing, .waitingForChrome:
            "dot.radiowaves.left.and.right"
        case .error:
            "exclamationmark.triangle.fill"
        case .idle, .disconnected:
            "link"
        }
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

private struct ConnectedSessionHeader: View {
    let name: String

    var body: some View {
        Label(name, systemImage: "desktopcomputer")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .frame(maxWidth: 220)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Connected session \(name)")
    }
}
