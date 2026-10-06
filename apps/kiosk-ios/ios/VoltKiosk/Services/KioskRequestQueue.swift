import Foundation
import Observation

@MainActor
@Observable
final class KioskRequestQueue {
    private(set) var requests: [KioskProductRequest] = []
    private(set) var isLoading = true
    private(set) var isConnected = false
    private(set) var rowErrors: [String: String] = [:]
    private(set) var retryStatuses: [String: KioskRequestStatus] = [:]
    private(set) var updatingIDs: Set<String> = []
    private(set) var serverNowMilliseconds = Date.now.timeIntervalSince1970 * 1_000

    private let storeSlug: String
    private let api: any KioskServing
    private var serverClockOffsetMilliseconds: Double = 0
    private var revision = 0

    init(storeSlug: String, api: any KioskServing) {
        self.storeSlug = storeSlug
        self.api = api
    }

    var waitingCount: Int { requests.filter { $0.status == .waiting }.count }
    var foundCount: Int { requests.filter { $0.status == .found }.count }

    func runPolling() async {
        while !Task.isCancelled {
            await refresh()
            tick()
            do {
                try await Task.sleep(nanoseconds: 3_000_000_000)
            } catch {
                return
            }
        }
    }

    func refresh() async {
        guard !Task.isCancelled else { return }
        let refreshRevision = revision
        do {
            let response = try await api.queue(storeSlug: storeSlug)
            try Task.checkCancellation()
            serverClockOffsetMilliseconds = response.serverNow - Date.now.timeIntervalSince1970 * 1_000
            tick()
            isConnected = true
            isLoading = false

            guard refreshRevision == revision else { return }
            let currentTime = serverNowMilliseconds
            let inFlight = Set(updatingIDs)
            let inFlightRequests = requests.filter { inFlight.contains($0.id) }
            let received = response.requests.filter { $0.status.isActive && $0.expiresAt > currentTime }
            let merged = received.filter { !inFlight.contains($0.id) } + inFlightRequests
            requests = merged.sorted { $0.createdAt < $1.createdAt }
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            isLoading = false
            isConnected = false
        }
    }

    func update(_ request: KioskProductRequest, to status: KioskRequestStatus) async {
        guard status != .waiting,
              request.status.isActive,
              !updatingIDs.contains(request.id) else { return }

        updatingIDs.insert(request.id)
        retryStatuses[request.id] = status
        rowErrors.removeValue(forKey: request.id)
        revision &+= 1

        do {
            let updated = try await api.updateRequest(storeSlug: storeSlug, id: request.id, status: status)
            revision &+= 1
            updatingIDs.remove(request.id)
            retryStatuses.removeValue(forKey: request.id)
            rowErrors.removeValue(forKey: request.id)

            if updated.status.isActive && updated.expiresAt > serverNowMilliseconds {
                if let index = requests.firstIndex(where: { $0.id == updated.id }) {
                    requests[index] = updated
                } else {
                    requests.append(updated)
                }
            } else {
                requests.removeAll { $0.id == updated.id }
            }
            requests.sort { $0.createdAt < $1.createdAt }
        } catch is CancellationError {
            updatingIDs.remove(request.id)
            retryStatuses.removeValue(forKey: request.id)
        } catch {
            updatingIDs.remove(request.id)
            rowErrors[request.id] = error.localizedDescription
        }
    }

    func tick(at date: Date = .now) {
        serverNowMilliseconds = date.timeIntervalSince1970 * 1_000 + serverClockOffsetMilliseconds
        requests.removeAll { !$0.status.isActive || $0.expiresAt <= serverNowMilliseconds }
    }

    func runClock() async {
        while !Task.isCancelled {
            tick()
            do { try await Task.sleep(for: .seconds(1)) }
            catch { return }
        }
    }
}
