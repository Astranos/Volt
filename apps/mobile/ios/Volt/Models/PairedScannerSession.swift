import Foundation

struct PairedScannerSession: Identifiable, Codable, Equatable {
    var id: String
    var browserSessionId: String
    var displayName: String
    var pairedAt: Date
    var lastConnectedAt: Date

    var sessionId: String? {
        browserSessionId
    }
}
