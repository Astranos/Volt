import SwiftUI

struct KioskProductCard: View {
    let product: KioskProduct
    let select: () -> Void

    var body: some View {
        Button(action: select) {
            VStack(alignment: .leading, spacing: 12) {
                KioskRemoteImage(url: product.images.first, title: product.title)
                    .frame(height: 230)
                    .frame(maxWidth: .infinity)
                    .background(.white)
                Text(product.category.rawValue.uppercased())
                    .font(.caption).bold().foregroundStyle(KioskCustomerStyle.green)
                Text(product.title).font(.headline).foregroundStyle(.primary)
                    .lineLimit(3, reservesSpace: true)
                Text(product.condition).font(.footnote).foregroundStyle(.secondary)
                    .lineLimit(2, reservesSpace: true)
                HStack(alignment: .firstTextBaseline) {
                    Text(product.formattedPrice).font(.title2).bold()
                    Spacer(minLength: 4)
                    Image(systemName: "arrow.up.right").accessibilityHidden(true)
                }
                .foregroundStyle(KioskCustomerStyle.green)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: RoundedRectangle(cornerRadius: KioskCustomerStyle.radius))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens product photos, details, and request options")
        .accessibilityInputLabels([product.title])
    }
}
