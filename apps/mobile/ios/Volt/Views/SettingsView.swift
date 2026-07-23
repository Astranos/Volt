import SwiftUI

struct SettingsView: View {
    @Environment(ScannerStore.self) private var store
    let showsAccountSettings: Bool

    init(showsAccountSettings: Bool = true) {
        self.showsAccountSettings = showsAccountSettings
    }

    var body: some View {
        @Bindable var store = store

        NavigationStack {
            Form {
                if showsAccountSettings {
                    AccessSettingsSection()
                } else {
                    Section("Cloud Workspace") {
                        Text("Capture works offline. Enroll this device by scanning a one-time QR from signed-in Chrome.")
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Barcodes") {
                    Picker("Recognized Codes", selection: $store.barcodeRecognitionMode) {
                        ForEach(BarcodeRecognitionMode.allCases) { mode in
                            Text(mode.title)
                                .tag(mode)
                        }
                    }
                    .pickerStyle(.navigationLink)
                }
            }
            .navigationTitle("Settings")
            .task {
                store.selectedSection = .settings
            }
        }
    }
}
