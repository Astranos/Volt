import SwiftUI

struct KioskStoreHero: View {
    let store: KioskStore?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 16) {
                    logo
                    message
                }
                VStack(alignment: .leading, spacing: 8) {
                    logo
                    message
                }
            }

            if let store {
                VStack(alignment: .leading, spacing: 3) {
                    Label(store.name, systemImage: "mappin.and.ellipse")
                        .font(.subheadline.weight(.semibold))
                    if !store.address.isEmpty {
                        Text(store.address)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .foregroundStyle(.white)
        .background(KioskCustomerStyle.green, in: RoundedRectangle(cornerRadius: KioskCustomerStyle.radius))
    }

    private var logo: some View {
        Image("PayMoreLogo")
            .resizable()
            .scaledToFit()
            .frame(width: 132)
            .accessibilityLabel("PayMore")
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(.white, in: RoundedRectangle(cornerRadius: 8))
    }

    private var message: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Find your next favorite.")
                .font(.title2)
                .bold()
            Text("Browse electronics in store. Tap an item and we’ll help you take a closer look.")
                .font(.body)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
