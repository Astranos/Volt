@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ClipConnectionSheet: View {
    @Bindable var store: ClipScannerStore
    let onDisconnect: () -> Void
    let onScanQRCode: () -> Void

    var body: some View {
        Group {
            if store.isPairing {
                ClipConnectionProgressView(
                    store: store,
                    onCancel: {
                        store.cancelConnectionAttempt()
                    },
                    onScanQRCode: {
                        store.cancelConnectionAttempt()
                        onScanQRCode()
                    }
                )
            } else if store.pairingFailureMessage != nil {
                ClipPairingFailureView(store: store, onScanQRCode: onScanQRCode)
            } else {
                ClipConnectChoicesView(
                    store: store,
                    onReconnect: {
                        store.reconnectToLastSession()
                    },
                    onDisconnect: onDisconnect,
                    onScanQRCode: onScanQRCode
                )
            }
        }
    }
}

struct ClipConnectChoicesView: View {
    @Bindable var store: ClipScannerStore
    @Environment(\.dismiss) private var dismiss
    @State private var pairingURL = ""
    @State private var manualPairingError: String?
    let onReconnect: () -> Void
    let onDisconnect: () -> Void
    let onScanQRCode: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section("Guest workspace") {
                    if store.isConnected {
                        Text("Choose which workspace computer receives captures, or scan a QR code for a different workspace.")
                            .font(.body)
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)

                        ClipDetailRow(
                            title: "Connected",
                            value: store.connectionAttemptDisplayName,
                            systemImage: "checkmark.circle"
                        )
                        .padding(14)
                        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    } else if let displayName = store.lastSessionDisplayName {
                        Text("Reconnect to \(displayName), or scan a QR code for a different workspace.")
                            .font(.body)
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)

                        ClipDetailRow(
                            title: "Last Session",
                            value: displayName,
                            systemImage: "clock.arrow.circlepath"
                        )
                        .padding(14)
                        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    } else {
                        Text("Scan the Volt App Clip QR from Chrome to open its workspace.")
                            .font(.body)
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                }

                Section("Connection") {
                    if store.isConnected {
                        Button(role: .destructive) {
                            onDisconnect()
                        } label: {
                            Label("Disconnect", systemImage: "xmark.circle")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 62)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                    } else if store.lastSessionDisplayName != nil {
                        Button {
                            onReconnect()
                        } label: {
                            Label("Reconnect", systemImage: "arrow.clockwise")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 62)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                    }

                    Button {
                        onScanQRCode()
                    } label: {
                        Label("Scan QR", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 62)
                    }
                    .buttonStyle(.bordered)
                    .tint(.green)
                }
                Section {
                    TextField("Paste workspace pairing URL", text: $pairingURL)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Workspace pairing URL")
                    Button("Connect Workspace", systemImage: "link") {
                        let value = pairingURL.trimmingCharacters(in: .whitespacesAndNewlines)
                        if store.pairFromScannedValue(value) {
                            manualPairingError = nil
                        } else {
                            manualPairingError = "Use a Volt workspace pairing URL from the Chrome extension."
                        }
                    }
                    .disabled(pairingURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if let manualPairingError {
                        Text(manualPairingError).foregroundStyle(.red)
                    }
                } header: {
                    Text("Pair with a link")
                } footer: {
                    Text("Scan the QR code or paste its pairing URL from the Volt Chrome extension. No account sign-in is required.")
                }
            }
            .navigationTitle(store.isConnected ? "Type to Computer" : "Connect Workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

struct ClipConnectionProgressView: View {
    @Bindable var store: ClipScannerStore
    let onCancel: () -> Void
    let onScanQRCode: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.large)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Connecting")
                            .font(.title2.bold())
                        Text(store.connectionAttemptDisplayName)
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }

                ClipDetailRow(
                    title: "Workspace",
                    value: store.connectionAttemptDisplayName,
                    systemImage: "desktopcomputer"
                )

                ClipDetailRow(
                    title: "Status",
                    value: store.statusText,
                    systemImage: "waveform.path.ecg"
                )

                Spacer(minLength: 0)

                VStack(spacing: 10) {
                    Button(role: .cancel) {
                        onCancel()
                    } label: {
                        Label("Cancel", systemImage: "xmark.circle")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 62)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        onScanQRCode()
                    } label: {
                        Label("Scan QR", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 62)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }
            }
            .padding(ScannerTabLayout.contentPadding)
            .navigationTitle("Connecting")
        }
    }
}

struct ClipPairingFailureView: View {
    @Bindable var store: ClipScannerStore
    @Environment(\.dismiss) private var dismiss
    let onScanQRCode: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Label("Connection Failed", systemImage: "exclamationmark.triangle.fill")
                    .font(.title2.bold())
                    .foregroundStyle(.red)

                Text(store.pairingFailureMessage ?? "The App Clip could not connect to the workspace.")
                    .font(.body)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Retry can help if the network was slow. If the QR expired or opened the wrong workspace, create and scan a fresh Volt QR code.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)

                VStack(spacing: 10) {
                    Button {
                        store.retryFailedConnection()
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 62)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(!store.canRetryConnection)

                    Button {
                        onScanQRCode()
                    } label: {
                        Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 62)
                    }
                    .buttonStyle(.bordered)
                    .tint(.green)
                }
            }
            .padding(ScannerTabLayout.contentPadding)
            .navigationTitle("Chrome Session")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

struct ClipDetailRow: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
