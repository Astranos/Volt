import Foundation

struct KioskCatalog: Codable, Equatable, Sendable {
    let store: KioskStore
    let products: [KioskProduct]
    let checkedAt: Date
    let status: Status

    enum Status: String, Codable, Sendable { case fresh, stale }

    func isExpired(at now: Date) -> Bool { now.timeIntervalSince(checkedAt) > 300 }
    func acceptsRequests(at now: Date) -> Bool {
        // The server validates the item against fresh inventory when POSTing.
        status == .fresh && !isExpired(at: now)
    }
}
