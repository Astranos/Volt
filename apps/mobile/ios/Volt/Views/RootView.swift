import SwiftUI
import UIKit

struct RootView: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = AppSection.text
    @State private var isCaptureSessionPresented = false
    @State private var presentedSheet: RootPresentedSheet?
    private let showsAccountSettings: Bool

    private var ownershipConflictIsPresented: Binding<Bool> {
        Binding(
            get: { store.cloudWorkspace.accountSwitchConflict != nil },
            set: { _ in }
        )
    }

    private var targetSymbol: String {
        if store.cloudWorkspace.selectedComputer != nil {
            return "cursorarrow.motionlines"
        }
        if store.cloudWorkspace.selectedTargetComputer != nil {
            return "desktopcomputer.trianglebadge.exclamationmark"
        }
        return "iphone"
    }

    init(showsAccountSettings: Bool = true) {
        self.showsAccountSettings = showsAccountSettings
        let initialSection = ScreenshotScenario.current?.initialSection
        _selectedTab = State(initialValue: initialSection == .photos ? .photos : .text)
    }

    var body: some View {
        selectedContent
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear
                .frame(height: RootTabBar.reservedSpace)
                .accessibilityHidden(true)
        }
        .overlay(alignment: .bottom) {
            RootTabBar(
                selection: $selectedTab,
                onScan: startCapture,
                onConnections: { presentedSheet = .connections },
                onSettings: { presentedSheet = .settings },
                targetSymbol: targetSymbol
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
            .ignoresSafeArea(.container, edges: .bottom)
        }
        .fullScreenCover(isPresented: $isCaptureSessionPresented, onDismiss: {
            store.endCaptureSession()
        }) {
            CaptureSessionView(isPresented: $isCaptureSessionPresented, mode: .ocr)
        }
        .sheet(item: $presentedSheet) { sheet in
            switch sheet {
            case .connections:
                CloudTargetPickerSheet()
            case .settings:
                SettingsSheet(showsAccountSettings: showsAccountSettings)
            }
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

    @ViewBuilder
    private var selectedContent: some View {
        switch selectedTab {
        case .text, .barcode, .dictation:
            UnifiedCaptureHomeView()
        case .photos:
            CaptureHistoryView()
        case .settings:
            SettingsView(showsAccountSettings: showsAccountSettings)
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

    private func startCapture() {
        selectedTab = .text
        store.clearOcrReview()
        store.beginCaptureSession()
        isCaptureSessionPresented = true
    }
}

private enum RootPresentedSheet: String, Identifiable {
    case connections
    case settings

    var id: String { rawValue }
}

private struct RootTabBar: View {
    static let reservedSpace: CGFloat = 74

    @Binding var selection: AppSection
    let onScan: () -> Void
    let onConnections: () -> Void
    let onSettings: () -> Void
    let targetSymbol: String

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 12) {
                controls
            }
            .padding(.top, 10)
            .frame(maxWidth: .infinity)
        } else {
            controls
                .padding(.top, 10)
                .frame(maxWidth: .infinity)
                .background(.ultraThinMaterial)
        }
    }

    private var controls: some View {
        HStack(spacing: 12) {
            connectionsButton
            scanButton
            settingsButton
        }
    }

    private var connectionsButton: some View {
        Button(action: onConnections) {
            Image(systemName: targetSymbol)
                .font(.subheadline.weight(.semibold))
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .rootTabBarGlass(isSelected: false)
        .accessibilityLabel("Connections")
        .accessibilityHint("Choose the computer that receives text and barcode captures")
    }

    private var scanButton: some View {
        Button(action: onScan) {
            Label("Scan", systemImage: "camera.viewfinder")
                .font(.headline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .rootTabBarScanStyle()
        .tint(.green)
        .accessibilityLabel("Scan")
        .accessibilityHint("Shows the scanner")
        .accessibilityAddTraits(selection == .text ? .isSelected : [])
    }

    private var settingsButton: some View {
        Button {
            onSettings()
        } label: {
            Label("Settings", systemImage: "gearshape")
                .labelStyle(.iconOnly)
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .foregroundStyle(selection == .settings ? .primary : .secondary)
        .rootTabBarGlass(isSelected: selection == .settings)
        .accessibilityLabel("Settings")
        .accessibilityHint("Shows app settings")
        .accessibilityAddTraits(selection == .settings ? .isSelected : [])
    }
}

private struct RootTabBarGlassModifier: ViewModifier {
    let isSelected: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.buttonStyle(
                .glass(.regular.tint(isSelected ? .accentColor.opacity(0.16) : .clear))
            )
            .buttonBorderShape(.circle)
        } else {
            content
                .buttonStyle(.bordered)
                .buttonBorderShape(.circle)
                .tint(isSelected ? .accentColor : .secondary)
        }
    }
}

private struct RootTabBarScanStyleModifier: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.buttonStyle(.glassProminent)
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}

private extension View {
    func rootTabBarGlass(isSelected: Bool) -> some View {
        modifier(RootTabBarGlassModifier(isSelected: isSelected))
    }

    func rootTabBarScanStyle() -> some View {
        modifier(RootTabBarScanStyleModifier())
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
