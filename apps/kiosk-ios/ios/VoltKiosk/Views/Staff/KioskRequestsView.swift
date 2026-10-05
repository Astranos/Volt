import SwiftUI

struct KioskRequestsView: View {
    let store: KioskStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var queue: KioskRequestQueue

    init(store: KioskStore, api: any KioskServing) {
        self.store = store
        _queue = State(initialValue: KioskRequestQueue(storeSlug: store.slug, api: api))
    }

    private var isActive: Bool { scenePhase == .active }

    var body: some View {
        VStack(spacing: 0) {
            header
            if !queue.isConnected && !queue.isLoading {
                connectionNotice
            }
            queueContent
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .tint(Color(red: 0.04, green: 0.37, blue: 0.21))
        .task(id: isActive) {
            guard isActive else { return }
            await queue.runPolling()
        }
        .task(id: isActive) {
            guard isActive else { return }
            await queue.runClock()
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Product requests")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)
                Text(store.name)
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 12)
            Button("Done", action: { dismiss() })
                .buttonStyle(.bordered)
                .frame(minHeight: 44)
            if queue.isConnected {
                Label("Connected", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .foregroundStyle(.green)
                    .accessibilityLabel("Connected to request queue")
            }
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 22)
        .background(.background)
    }

    private var connectionNotice: some View {
        HStack(spacing: 14) {
            Label("Connection lost", systemImage: "wifi.slash")
                .font(.headline)
                .foregroundStyle(.orange)
            Text("Showing the latest requests received.")
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Button("Retry", systemImage: "arrow.clockwise") {
                Task { await queue.refresh() }
            }
            .buttonStyle(.bordered)
            .frame(minHeight: 44)
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 12)
        .background(Color.orange.opacity(0.10))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var queueContent: some View {
        if queue.requests.isEmpty && queue.isLoading {
            ProgressView("Loading requests…")
                .font(.title3)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if queue.requests.isEmpty {
            ContentUnavailableView(
                "No active requests",
                systemImage: "tray",
                description: Text("New customer requests will appear here automatically.")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 12) {
                        countBadge(title: "Waiting", count: queue.waitingCount, color: .orange)
                        countBadge(title: "Found", count: queue.foundCount, color: .green)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(queue.waitingCount) waiting, \(queue.foundCount) found")

                    LazyVStack(spacing: 14) {
                        ForEach(queue.requests) { request in
                            KioskRequestRow(
                                request: request,
                                serverNowMilliseconds: queue.serverNowMilliseconds,
                                isUpdating: queue.updatingIDs.contains(request.id),
                                error: queue.rowErrors[request.id],
                                retryStatus: queue.retryStatuses[request.id],
                                onUpdate: { status in
                                    Task { await queue.update(request, to: status) }
                                }
                            )
                            .disabled(!queue.isConnected || !isActive)
                        }
                    }
                }
                .padding(24)
                .frame(maxWidth: 1500)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func countBadge(title: String, count: Int, color: Color) -> some View {
        Label("\(count) \(title)", systemImage: title == "Waiting" ? "clock" : "checkmark.circle")
            .font(.headline)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
    }
}
