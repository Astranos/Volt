import Foundation

struct KioskQueueResponse: Codable, Sendable {
    let requests: [KioskProductRequest]
    let serverNow: Double
}
