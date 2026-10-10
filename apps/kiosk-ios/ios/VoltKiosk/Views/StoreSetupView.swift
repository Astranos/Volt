import SwiftUI

struct StoreSetupView: View {
    let session: KioskSession
    @Environment(\.dismiss) private var dismiss
    @State private var showingPrivacy = false
    @State private var address = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image(systemName: "ipad.landscape")
                        .font(.largeTitle)
                        .foregroundStyle(.green)
                        .accessibilityHidden(true)
                    Text("Your store. Ready to browse.")
                        .font(.largeTitle.bold())
                    Text("Choose the PayMore store for this iPad. Customers will see this store’s inventory and can ask an associate to bring an item to the counter.")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("PayMore store address").font(.headline)
                        TextField("southfieldmi.paymore.com", text: $address)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .textContentType(.URL)
                            .textFieldStyle(.roundedBorder)
                            .submitLabel(.go)
                            .onSubmit(connect)
                            .accessibilityIdentifier("storeAddress")
                        Text("Enter a store subdomain, such as southfieldmi, or its PayMore address.")
                            .foregroundStyle(.secondary)
                        if let error = session.setupError {
                            Label(error, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.red)
                                .accessibilityIdentifier("storeSetupError")
                        }
                        Button(action: connect) {
                            HStack {
                                if session.isConnecting { ProgressView().tint(.white) }
                                Text(session.isConnecting ? "Connecting…" : "Open store")
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                        .disabled(address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || session.isConnecting)
                        .accessibilityIdentifier("openStore")
                    }
                    Divider()
                    Label("Lock the iPad for customers", systemImage: "lock.shield")
                        .font(.headline)
                    Text("After opening the catalog, enable Guided Access in Settings → Accessibility. Set a staff passcode, then triple-click the top or Home button to start Guided Access. Keep touch and the software keyboard enabled for browsing and search.")
                        .foregroundStyle(.secondary)
                    Text("Store setup and staff requests are hidden while Guided Access is active.")
                        .foregroundStyle(.secondary)
                    Divider()
                    Text("Volt Kiosk is an independent tool for participating stores. It is not affiliated with, sponsored by, or endorsed by PayMore.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("Privacy policy") { showingPrivacy = true }
                        .frame(minHeight: 44)
                }
                .padding(32)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Kiosk setup")
            .toolbar {
                if session.storeSlug != nil {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", action: { dismiss() })
                    }
                }
            }
        }
        .sheet(isPresented: $showingPrivacy) { KioskPrivacyNoticeView() }
        .onAppear { address = session.storeSlug ?? "" }
    }

    private func connect() {
        Task {
            if await session.connect(to: address) { dismiss() }
        }
    }
}
