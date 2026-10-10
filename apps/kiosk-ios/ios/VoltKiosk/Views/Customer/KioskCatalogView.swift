import SwiftUI

struct KioskCatalogView: View {
    @Bindable var session: KioskSession
    @State private var showingPrivacy = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: dynamicTypeSize.isAccessibilitySize ? 320 : 240), spacing: 20, alignment: .top)]
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: KioskCustomerStyle.spacing) {
                    KioskStoreHero(store: session.catalog?.store, startOver: session.resetBrowsing).id("catalog-top")
                    KioskCatalogFiltersView(session: session)
                    KioskCatalogNotice(session: session)
                    if session.isLoading && session.catalog == nil {
                        ProgressView("Loading store inventory…").frame(maxWidth: .infinity).padding(48)
                    } else if session.catalog == nil {
                        ContentUnavailableView("Inventory unavailable", systemImage: "wifi.exclamationmark", description: Text("Please try again or ask an associate for help."))
                        Button("Try again", systemImage: "arrow.clockwise", action: refresh).buttonStyle(.borderedProminent)
                    } else if session.catalogExpired {
                        ContentUnavailableView("Inventory needs an update", systemImage: "clock.arrow.circlepath", description: Text("Refresh to see current items. An associate can also help you find what you need."))
                        Button("Refresh inventory", systemImage: "arrow.clockwise", action: refresh).buttonStyle(.borderedProminent)
                    } else if session.catalog?.products.isEmpty == true {
                        ContentUnavailableView("No items available right now", systemImage: "shippingbox", description: Text("Please ask an associate about current inventory or check again shortly."))
                    } else if session.visibleProducts.isEmpty {
                        ContentUnavailableView("No items found", systemImage: "magnifyingglass", description: Text("Try another search or clear your filters."))
                    } else {
                        Text("\(session.visibleProducts.count) \(session.visibleProducts.count == 1 ? "item" : "items") to explore")
                            .font(.title2).bold().accessibilityAddTraits(.isHeader)
                        LazyVGrid(columns: columns, spacing: 20) {
                            ForEach(session.visibleProducts.prefix(session.productLimit)) { product in
                                KioskProductCard(product: product) { select(product) }
                            }
                        }
                        if session.productLimit < session.visibleProducts.count {
                            Button("Show more items", systemImage: "plus.circle", action: showMore)
                                .font(.headline).frame(maxWidth: .infinity, minHeight: 56)
                                .buttonStyle(.bordered)
                        }
                    }
                    Button("Privacy policy") {
                        session.recordActivity()
                        showingPrivacy = true
                    }
                    .font(.footnote)
                    .frame(minHeight: 44)
                }
                .padding(24)
                .frame(maxWidth: 1500)
                .frame(maxWidth: .infinity)
            }
            .sheet(isPresented: $showingPrivacy) { KioskPrivacyNoticeView() }
            .refreshable { session.recordActivity(); await session.refresh() }
            .scrollDismissesKeyboard(.interactively)
            .background(KioskCustomerStyle.background)
            .tint(KioskCustomerStyle.green)
            .onChange(of: session.resetID) { _, _ in proxy.scrollTo("catalog-top", anchor: .top) }
        }
    }

    private func select(_ product: KioskProduct) { session.recordActivity(); session.selectedProduct = product }
    private func showMore() { session.recordActivity(); session.productLimit += 24 }
    private func refresh() { session.recordActivity(); Task { await session.refresh() } }
}
