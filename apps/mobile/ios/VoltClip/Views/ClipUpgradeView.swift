import StoreKit
import SwiftUI

struct ClipUpgradeView: View {
    @Environment(\.openURL) private var openURL
    let onShowAppStoreOverlay: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Label("Continue in the Full App", systemImage: "bolt.fill")
                    .font(.title2.bold())
                    .foregroundStyle(.green)

                Text("The App Clip stays free and does not offer checkout. Install Volt to sign in, use complimentary workplace access, or subscribe through the App Store.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)

                Button("Get Volt", systemImage: "arrow.down.app", action: onShowAppStoreOverlay)
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .frame(maxWidth: .infinity, minHeight: 44)

                Button("Open App Store", systemImage: "safari", action: openFullApp)
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .padding()
            .navigationTitle("Volt Access")
        }
    }

    private func openFullApp() {
        let configuredID = Bundle.main.object(forInfoDictionaryKey: "VoltAppStoreID") as? String
        let appStoreID = configuredID?.isEmpty == false ? configuredID : "6771770148"
        guard let appStoreID,
              let url = URL(string: "https://apps.apple.com/app/id\(appStoreID)")
        else { return }
        openURL(url)
    }
}
