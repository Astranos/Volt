import Foundation

struct CloudDeviceCredential: Codable, Equatable, Sendable {
    let value: String
    let deviceId: String
    let workspaceId: String
    let enrolledAt: Date
}
