import Foundation

struct CloudDeviceCredential: Codable, Equatable, Sendable {
    let value: String
    let deviceId: String
    let workspaceId: String
    let ownerClerkUserId: String?
    let enrolledAt: Date

    var clerkUserId: String? { ownerClerkUserId }
}
