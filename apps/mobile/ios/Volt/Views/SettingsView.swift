import SwiftUI

struct SettingsView: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let showsAccountSettings: Bool
    let showsDoneButton: Bool

    init(showsAccountSettings: Bool = true, showsDoneButton: Bool = false) {
        self.showsAccountSettings = showsAccountSettings
        self.showsDoneButton = showsDoneButton
    }

    var body: some View {
        @Bindable var store = store

        NavigationStack {
            Form {
                if showsAccountSettings {
                    AccessSettingsSection()
                } else {
                    Section("Cloud Workspace") {
                        Text("Capture works offline. Sign in from a configured Volt build to sync captures to your account workspace.")
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
            .toolbar {
                if showsDoneButton {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
            .task {
                if !showsDoneButton {
                    store.selectedSection = .settings
                }
            }
        }
    }
}

struct SettingsSheet: View {
    let showsAccountSettings: Bool

    var body: some View {
        SettingsView(showsAccountSettings: showsAccountSettings, showsDoneButton: true)
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
    }
}
