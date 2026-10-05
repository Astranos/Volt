import SwiftUI

struct KioskProductSummary: View {
    let product: KioskProduct
    let session: KioskSession

    private var conditionSymbol: String {
        let condition = product.condition.lowercased()
        return condition.contains("parts") || condition.contains("repair") ? "wrench.and.screwdriver" : "info.circle"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 12) {
                Text(product.category.rawValue.uppercased()).font(.caption).bold().foregroundStyle(KioskCustomerStyle.green)
                Text(product.title).font(.largeTitle).bold().accessibilityAddTraits(.isHeader)
                Text(product.formattedPrice).font(.largeTitle).bold().foregroundStyle(KioskCustomerStyle.green)
                if !product.condition.isEmpty && product.condition != "See item details" {
                    Label(product.condition, systemImage: conditionSymbol).font(.headline)
                }
            }
            if !session.canRequest(productID: product.id) {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Availability cannot be confirmed. Please ask an associate or refresh the inventory.", systemImage: "exclamationmark.triangle")
                    Button("Refresh inventory", systemImage: "arrow.clockwise", action: refresh)
                        .frame(minHeight: 44).disabled(session.isLoading)
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
            }
            if product.variants.isEmpty {
                Text("Please ask an associate for this item.").foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    Text(product.variants.count == 1 ? "See this item in store" : "Choose an option").font(.title2).bold()
                    ForEach(product.variants) { variant in
                        KioskVariantRequestView(product: product, variant: variant, session: session)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func refresh() { session.recordActivity(); Task { await session.refresh() } }
}
