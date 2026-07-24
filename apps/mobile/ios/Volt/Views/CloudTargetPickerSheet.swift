import SwiftUI

struct CloudTargetButton: View {
    @Environment(ScannerStore.self) private var store
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(targetLabel, systemImage: targetSymbol)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
        }
        .buttonStyle(.bordered)
        .accessibilityHint("Choose the computer that receives text and barcode captures.")
    }

    private var targetLabel: String {
        store.cloudWorkspace.selectedTargetComputer?.label ?? "This iPhone"
    }

    private var targetSymbol: String {
        if store.cloudWorkspace.selectedComputer != nil {
            return "cursorarrow.motionlines"
        }
        if store.cloudWorkspace.selectedTargetComputer != nil {
            return "desktopcomputer.trianglebadge.exclamationmark"
        }
        return "iphone"
    }
}

struct CloudTargetPickerSheet: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    targetButton(
                        title: "This iPhone",
                        subtitle: "Save to Volt without typing into a computer.",
                        systemImage: "iphone",
                        deviceId: nil
                    )
                }

                Section("Available Now") {
                    if store.cloudWorkspace.availableComputers.isEmpty {
                        ContentUnavailableView(
                            "No Computers Online",
                            systemImage: "desktopcomputer",
                            description: Text("Open the Volt extension on a signed-in computer to make it available.")
                        )
                    } else {
                        ForEach(store.cloudWorkspace.availableComputers) { computer in
                            targetButton(
                                title: computer.label,
                                subtitle: "Online · Ready for text and barcodes",
                                systemImage: "desktopcomputer",
                                deviceId: computer.deviceId
                            )
                        }
                    }
                }

                if !store.cloudWorkspace.unavailableComputers.isEmpty {
                    Section("Offline") {
                        ForEach(store.cloudWorkspace.unavailableComputers) { computer in
                            HStack(spacing: 12) {
                                Image(systemName: "desktopcomputer")
                                    .foregroundStyle(.secondary)
                                    .frame(width: 28)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(computer.label)
                                    Text("Open the Volt extension on this computer to reconnect.")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("\(computer.label), offline")
                        }
                    }
                }
            }
            .navigationTitle("Type to Computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func targetButton(
        title: String,
        subtitle: String,
        systemImage: String,
        deviceId: String?
    ) -> some View {
        Button {
            Task {
                await store.cloudWorkspace.selectTarget(deviceId: deviceId)
                dismiss()
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .foregroundStyle(.green)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if store.cloudWorkspace.selectedTargetDeviceId == deviceId {
                    Image(systemName: "checkmark")
                        .font(.headline)
                        .foregroundStyle(.green)
                }
            }
        }
    }
}
