import Foundation

struct KioskRequestReceipt: Codable, Equatable, Sendable {
    let id: String
    let status: KioskRequestStatus
    let createdAt: Double
    let expiresAt: Double
}
