import SwiftUI

struct KioskStoreHero: View {
    let store: KioskStore?
    let startOver: () -> Void

    var body: some View {
        HStack(spacing: 20) {
            Image("PayMoreLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 170, height: 48)
                .accessibilityLabel("PayMore")
            if let store {
                VStack(alignment: .leading, spacing: 3) {
                    Text(store.name).font(.headline)
                    if !store.address.isEmpty {
                        Text(store.address).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            Spacer(minLength: 0)
            Button("Start over", systemImage: "arrow.counterclockwise", action: startOver)
                .labelStyle(.iconOnly)
                .font(.title3)
                .frame(width: 48, height: 48)
                .background(.white, in: Circle())
                .accessibilityIdentifier("startOver")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
        .foregroundStyle(KioskCustomerStyle.green)
    }
}
