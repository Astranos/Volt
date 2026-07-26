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
        _selectedTab = State(initialValue: ScreenshotScenario.current?.initialSection ?? .text)
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            CaptureModeTabView(mode: .ocr)
                .tabItem { Label("Text", systemImage: "doc.text.viewfinder") }
                .tag(AppSection.text)

            CaptureModeTabView(mode: .barcode)
                .tabItem { Label("Barcode", systemImage: "barcode.viewfinder") }
                .tag(AppSection.barcode)

            CaptureModeTabView(mode: .photo)
                .tabItem { Label("Photos", systemImage: "camera.viewfinder") }
                .tag(AppSection.photos)

            SessionsView()
                .tabItem { Label("Sessions", systemImage: "clock.arrow.circlepath") }
                .tag(AppSection.sessions)

            SettingsView(showsAccountSettings: showsAccountSettings)
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppSection.settings)
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
            case .inactive:
                break
            @unknown default:
                break
            }
        }
        .onDisappear {
            guard !ScreenshotScenario.isEnabled else { return }
            store.cloudWorkspace.setSubscriptionsActive(false)
        }
    }

    private func applySelectedTab(_ newTab: AppSection) {
        store.selectedSection = newTab
        switch newTab {
        case .text:
            store.activeMode = .ocr
        case .barcode:
            store.activeMode = .barcode
        case .photos:
            store.activeMode = .photo
        case .sessions, .settings:
            break
        }
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
    case sessions
    case settings
}
