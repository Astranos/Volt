@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ClipWorkspaceTargetCard: View {
    @Bindable var store: ClipScannerStore
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: "cursorarrow.motionlines")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.green)
                    .frame(width: 46, height: 46)
                    .background(.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))

                VStack(alignment: .leading, spacing: 3) {
                    Text(store.isConnected ? "Typing to \(store.typingTargetLabel)" : "Connect to a workspace")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text(store.isConnected ? "Choose from \(store.availableWorkspaceComputers.count) online workspace computer\(store.availableWorkspaceComputers.count == 1 ? "" : "s")" : "Scan a Volt QR code to start a guest session.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Changes the computer that receives text and barcode captures.")
    }
}

struct ClipWorkspaceTargetPickerSheet: View {
    @Bindable var store: ClipScannerStore
    let onManageConnection: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    targetButton(
                        title: "This iPhone",
                        subtitle: "Save to the workspace without typing into a computer.",
                        deviceId: nil
                    )
                }
                Section {
                    Button {
                        onManageConnection()
                        dismiss()
                    } label: {
                        Label("Workspace connection", systemImage: "qrcode.viewfinder")
                    }
                } footer: {
                    Text("Manage this guest connection or scan a QR code for another workspace.")
                }
                Section("Workspace Computers") {
                    if store.isLoadingWorkspaceComputers && store.workspaceComputers.isEmpty {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Loading computers…")
                                .foregroundStyle(.secondary)
                        }
                    } else if store.availableWorkspaceComputers.isEmpty {
                        ContentUnavailableView(
                            "No Computers Online",
                            systemImage: "desktopcomputer",
                            description: Text("Open the signed-in Volt extension on a computer to make it available.")
                        )
                    } else {
                        ForEach(store.availableWorkspaceComputers) { computer in
                            targetButton(
                                title: computer.label,
                                subtitle: "Online · Ready for text and barcode captures",
                                deviceId: computer.deviceId
                            )
                        }
                    }
                }

                if !store.unavailableWorkspaceComputers.isEmpty {
                    Section("Offline") {
                        ForEach(store.unavailableWorkspaceComputers) { computer in
                            Label(computer.label, systemImage: "desktopcomputer")
                                .foregroundStyle(.secondary)
                                .accessibilityLabel("\(computer.label), offline")
                        }
                    }
                }

                if let error = store.workspaceComputerError {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
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
            .refreshable {
                await store.refreshWorkspaceComputers()
            }
            .task {
                await store.refreshWorkspaceComputers()
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func targetButton(title: String, subtitle: String, deviceId: String?) -> some View {
        Button {
            store.selectWorkspaceComputer(deviceId: deviceId)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: deviceId == nil ? "iphone" : "desktopcomputer")
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
                if store.selectedWorkspaceComputerId == deviceId {
                    Image(systemName: "checkmark")
                        .font(.headline)
                        .foregroundStyle(.green)
                }
            }
        }
    }
}
