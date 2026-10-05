import SwiftUI
import UIKit

struct KioskRootContentView: View {
    @Bindable var session: KioskSession
    let api: any KioskServing
    @Environment(\.scenePhase) private var scenePhase
    @State private var guidedAccessEnabled = UIAccessibility.isGuidedAccessEnabled
    @State private var staffSheet: StaffSheet?

    private enum StaffSheet: String, Identifiable {
        case setup, requests
        var id: String { rawValue }
    }

    private struct PollingKey: Hashable {
        let storeSlug: String?
        let resetID: UUID
        let isActive: Bool
    }

    var body: some View {
        Group {
            if session.storeSlug == nil {
                if guidedAccessEnabled {
                    ContentUnavailableView("Ask staff to finish setup", systemImage: "lock.shield", description: Text("End Guided Access to choose this iPad’s store."))
                } else {
                    StoreSetupView(session: session)
                }
            } else {
                NavigationStack {
                    KioskCatalogView(session: session)
                        .navigationTitle("PayMore")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button("Start over", systemImage: "arrow.counterclockwise", action: session.resetBrowsing)
                                    .accessibilityIdentifier("startOver")
                            }
                        }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if let seconds = session.remainingIdleSeconds {
                        KioskIdleNotice(seconds: seconds, keepBrowsing: session.recordActivity)
                    } else if !guidedAccessEnabled {
                        KioskStaffBar(openSetup: { staffSheet = .setup }, openRequests: { staffSheet = .requests }, requestsEnabled: session.catalog != nil)
                    }
                }
            }
        }
        .tint(KioskCustomerStyle.green)
        .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in session.recordActivity() })
        .sheet(item: $session.selectedProduct) { product in
            KioskProductDetailView(product: product, session: session)
                .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in session.recordActivity() })
        }
        .sheet(item: $staffSheet) { sheet in
            switch sheet {
            case .setup: StoreSetupView(session: session)
            case .requests:
                if let store = session.catalog?.store {
                    KioskRequestsView(store: store, api: api)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.guidedAccessStatusDidChangeNotification)) { _ in
            guidedAccessEnabled = UIAccessibility.isGuidedAccessEnabled
            if guidedAccessEnabled { staffSheet = nil }
        }
        .task(id: PollingKey(storeSlug: session.storeSlug, resetID: session.resetID, isActive: scenePhase == .active)) {
            await refreshLoop()
        }
        .task(id: scenePhase) { await idleLoop() }
        .persistentSystemOverlays(.hidden)
    }

    private func refreshLoop() async {
        guard scenePhase == .active, session.storeSlug != nil else { return }
        while !Task.isCancelled {
            await session.refresh()
            do { try await Task.sleep(for: .seconds(60)) }
            catch { return }
        }
    }

    private func idleLoop() async {
        guard scenePhase == .active else { return }
        while !Task.isCancelled {
            if staffSheet != nil { session.recordActivity() }
            else { session.tick() }
            do { try await Task.sleep(for: .seconds(1)) }
            catch { return }
        }
    }
}
