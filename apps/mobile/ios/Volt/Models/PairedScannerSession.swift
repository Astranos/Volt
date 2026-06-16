import Foundation

struct PairedScannerSession: Identifiable, Codable, Equatable {
    var id: String
    var token: String
    var sessionId: String?
    var sourceURL: URL
    var displayName: String
    var lastConnectedAt: Date

    var pairingSession: PairingSession {
        PairingSession(
            token: token,
            sessionId: sessionId,
            attemptId: nil,
            offer: nil,
            answerURL: nil,
            sourceURL: sourceURL
        )
    }
}
