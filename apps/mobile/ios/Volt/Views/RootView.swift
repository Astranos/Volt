import SwiftUI
import UIKit

struct RootView: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = AppSection.text
    private let showsAccountSettings: Bool

    private var ownershipConflictIsPresented: Binding<Bool> {
        Binding(
            get: { store.cloudWorkspace.accountSwitchConflict != nil },
            set: { _ in }
        )
    }

    init(showsAccountSettings: Bool = true) {
        self.showsAccountSettings = showsAccountSettings
        let initialSection = ScreenshotScenario.current?.initialSection
        _selectedTab = State(initialValue: initialSection == .photos ? .photos : .text)
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            UnifiedCaptureHomeView()
                .tabItem { Label("Scan", systemImage: "camera.viewfinder") }
                .tag(AppSection.text)

            CaptureHistoryView()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                .tag(AppSection.photos)

            SettingsView(showsAccountSettings: showsAccountSettings)
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppSection.settings)
        }
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            RootTabBar(selection: $selectedTab)
        }
        .sheet(isPresented: ownershipConflictIsPresented) {
            if let conflict = store.cloudWorkspace.accountSwitchConflict {
                AccountSwitchCaptureDecisionView(
                    conflict: conflict,
                    onRetain: store.cloudWorkspace.retainConflictingCaptures,
                    onAttach: store.cloudWorkspace.attachConflictingCaptures,
                    onDelete: store.cloudWorkspace.deleteConflictingCaptures
                )
                .interactiveDismissDisabled()
            }
        }
        .onChange(of: selectedTab) { _, newValue in
            applySelectedTab(newValue)
        }
        .task {
            applySelectedTab(selectedTab)
            store.cloudWorkspace.requestSync()
            if !ScreenshotScenario.isEnabled {
                store.cloudWorkspace.setSubscriptionsActive(scenePhase == .active)
            }
        }
        .onChange(of: scenePhase) { _, newValue in
            guard !ScreenshotScenario.isEnabled else { return }
            switch newValue {
            case .active:
                store.cloudWorkspace.setSubscriptionsActive(true)
                store.cloudWorkspace.requestSync()
            case .background:
                store.cloudWorkspace.setSubscriptionsActive(false)
                Task { await store.cancelLiveDictation() }
            case .inactive:
                break
            @unknown default:
                break
            }
        }
        .onDisappear {
            guard !ScreenshotScenario.isEnabled else { return }
            store.cloudWorkspace.setSubscriptionsActive(false)
            Task { await store.cancelLiveDictation() }
        }
    }

    private func applySelectedTab(_ newTab: AppSection) {
        store.selectedSection = newTab
        switch newTab {
        case .text: store.activeMode = .ocr
        case .barcode, .dictation: store.activeMode = .ocr
        case .photos: break
        case .settings:
            break
        }
    }
}

private struct RootTabBar: View {
    @Binding var selection: AppSection

    var body: some View {
        HStack(spacing: 12) {
            historyButton
            scanButton
            settingsButton
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
        .overlay(alignment: .top) {
            Divider()
        }
    }

    private var historyButton: some View {
        Button {
            selection = .photos
        } label: {
            Label("History", systemImage: "list.bullet")
                .labelStyle(.iconOnly)
                .frame(width: 48, height: 48)
        }
        .buttonStyle(.plain)
        .foregroundStyle(selection == .photos ? .primary : .secondary)
        .background(
            selection == .photos ? Color.accentColor.opacity(0.14) : .clear,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .accessibilityLabel("History")
        .accessibilityHint("Shows capture history")
        .accessibilityAddTraits(selection == .photos ? .isSelected : [])
    }

    private var scanButton: some View {
        Button {
            selection = .text
        } label: {
            Label("Scan", systemImage: "camera.viewfinder")
                .font(.headline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(.borderedProminent)
        .tint(.green)
        .accessibilityLabel("Scan")
        .accessibilityHint("Shows the scanner")
        .accessibilityAddTraits(selection == .text ? .isSelected : [])
    }

    private var settingsButton: some View {
        Button {
            selection = .settings
        } label: {
            Label("Settings", systemImage: "gearshape")
                .labelStyle(.iconOnly)
                .frame(width: 48, height: 48)
        }
        .buttonStyle(.plain)
        .foregroundStyle(selection == .settings ? .primary : .secondary)
        .background(
            selection == .settings ? Color.accentColor.opacity(0.14) : .clear,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .accessibilityLabel("Settings")
        .accessibilityHint("Shows app settings")
        .accessibilityAddTraits(selection == .settings ? .isSelected : [])
    }
}

private struct AccountSwitchCaptureDecisionView: View {
    @State private var isExportPresented = false
    let conflict: CaptureOwnershipConflict
    let onRetain: () -> Void
    let onAttach: () -> Void
    let onDelete: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "person.crop.circle.badge.exclamationmark")
                    .font(.system(size: 42, weight: .semibold))
                    .foregroundStyle(.orange)

                Text("Captures from another account")
                    .font(.title2.bold())

                Text("\(conflict.count) pending capture\(conflict.count == 1 ? "" : "s") will stay on this iPhone until you choose what to do. Volt will never upload them to the new account automatically.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: 10) {
                    Button(action: onAttach) {
                        Label("Attach to Current Account", systemImage: "person.crop.circle.badge.plus")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)

                    Button {
                        isExportPresented = true
                    } label: {
                        Label("Export Captures", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)

                    Button(action: onRetain) {
                        Label("Retain on This iPhone", systemImage: "internaldrive")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)

                    Button(role: .destructive, action: onDelete) {
                        Label("Delete Pending Captures", systemImage: "trash")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                }

                Spacer()
            }
            .padding(24)
            .navigationTitle("Account Change")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.large])
        .sheet(isPresented: $isExportPresented) {
            CaptureExportShareSheet(items: exportItems)
        }
    }

    private var exportItems: [Any] {
        var items: [Any] = [conflict.exportText]
        items.append(contentsOf: conflict.exportPhotoURLs.map { $0 as Any })
        return items
    }
}

private struct CaptureExportShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

enum AppSection: Hashable {
    case text
    case barcode
    case photos
    case dictation
    case settings
}
