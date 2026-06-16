import SwiftUI

struct PairingSessionsView: View {
    @Environment(ScannerStore.self) private var store
    let showScanner: () -> Void

    var body: some View {
        NavigationStack {
            List {
                if store.pairedSessions.isEmpty {
                    ContentUnavailableView(
                        "No Paired Sessions",
                        systemImage: "link",
                        description: Text("Pair once from the Chrome QR code, then reconnect to that computer from here.")
                    )
                } else {
                    Section {
                        ForEach(store.pairedSessions) { session in
                            Button {
                                store.reconnect(to: session)
                                showScanner()
                            } label: {
                                PairedSessionRow(session: session)
                            }
                            .buttonStyle(.plain)
                            .swipeActions {
                                Button("Forget", systemImage: "trash", role: .destructive) {
                                    store.removePairedSession(session)
                                }
                            }
                        }
                    } header: {
                        Text("Previously Paired")
                    }
                }
            }
            .navigationTitle("Sessions")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if store.connectionStatus.isConnected {
                        Button("Unpair", systemImage: "link.badge.minus") {
                            store.unpair()
                        }
                    }
                }
            }
        }
    }
}

private struct PairedSessionRow: View {
    let session: PairedScannerSession

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "desktopcomputer")
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                Text(session.displayName)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(session.lastConnectedAt, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let sessionId = session.sessionId {
                    Text(sessionId)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}
