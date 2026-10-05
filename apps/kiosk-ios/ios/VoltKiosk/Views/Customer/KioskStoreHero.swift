import SwiftUI

struct KioskStoreHero: View {
    let store: KioskStore?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("PayMore").font(.title).bold()
            Text("Find your next favorite.").font(.largeTitle).bold()
            Text("Browse electronics in store. Tap an item and we’ll help you take a closer look.")
                .font(.title3)
            if let store {
                Divider().overlay(.white.opacity(0.3))
                Label(store.name, systemImage: "mappin.and.ellipse").font(.headline)
                if !store.address.isEmpty { Text(store.address).font(.body) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(28)
        .foregroundStyle(.white)
        .background(KioskCustomerStyle.green, in: RoundedRectangle(cornerRadius: KioskCustomerStyle.radius))
    }
}
