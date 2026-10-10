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
                KioskCatalogView(session: session)
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        if session.selectedProduct == nil {
                            if let seconds = session.remainingIdleSeconds {
                                KioskIdleNotice(seconds: seconds, keepBrowsing: session.recordActivity)
                            } else if !guidedAccessEnabled {
                                KioskStaffBar(openSetup: { staffSheet = .setup }, openRequests: { staffSheet = .requests }, requestsEnabled: session.catalog != nil)
                            }
                        }
                    }
            }
        }
        .allowsHitTesting(session.selectedProduct == nil)
        .accessibilityHidden(session.selectedProduct != nil)
        .tint(KioskCustomerStyle.green)
        .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in session.recordActivity() })
        .overlay {
            if let product = session.selectedProduct {
                KioskProductDetailPopup(product: product, session: session)
            }
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

private struct KioskProductDetailPopup: View {
    let product: KioskProduct
    let session: KioskSession

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Button(action: close) {
                    Color.black.opacity(0.4)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .ignoresSafeArea()
                .accessibilityLabel("Close item details")
                HStack(spacing: 12) {
                    Button("Previous item", systemImage: "chevron.left") {
                        selectAdjacentProduct(offset: -1)
                    }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.primary)
                    .font(.title3.weight(.semibold))
                    .frame(width: 48, height: 48)
                    .background(.regularMaterial, in: Circle())
                    .disabled(adjacentProduct(offset: -1) == nil)
                    .opacity(adjacentProduct(offset: -1) == nil ? 0.3 : 0.85)

                    KioskProductDetailView(product: product, session: session)
                        .frame(width: min(600, max(0, geometry.size.width - 168)), height: max(0, geometry.size.height - 48))
                        .clipShape(RoundedRectangle(cornerRadius: 24))
                        .shadow(color: .black.opacity(0.2), radius: 24, y: 8)

                    Button("Next item", systemImage: "chevron.right") {
                        selectAdjacentProduct(offset: 1)
                    }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.primary)
                    .font(.title3.weight(.semibold))
                    .frame(width: 48, height: 48)
                    .background(.regularMaterial, in: Circle())
                    .disabled(adjacentProduct(offset: 1) == nil)
                    .opacity(adjacentProduct(offset: 1) == nil ? 0.3 : 0.85)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .contain)
                .accessibilityAddTraits(.isModal)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in session.recordActivity() })
    }

    private func close() {
        session.recordActivity()
        session.selectedProduct = nil
    }

    private func adjacentProduct(offset: Int) -> KioskProduct? {
        guard let index = session.visibleProducts.firstIndex(where: { $0.id == product.id }) else { return nil }
        let adjacentIndex = index + offset
        guard session.visibleProducts.indices.contains(adjacentIndex) else { return nil }
        return session.visibleProducts[adjacentIndex]
    }

    private func selectAdjacentProduct(offset: Int) {
        guard let adjacent = adjacentProduct(offset: offset) else { return }
        session.recordActivity()
        session.selectedProduct = adjacent
    }
}
