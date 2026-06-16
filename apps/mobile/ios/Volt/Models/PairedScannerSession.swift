import Foundation

struct PairedScannerSession: Identifiable, Codable, Equatable {
    static let lifetime: TimeInterval = 12 * 60 * 60

    var id: String
    var token: String
    var sessionId: String?
    var sourceURL: URL
    var displayName: String
    var lastConnectedAt: Date

    var expiresAt: Date {
        lastConnectedAt.addingTimeInterval(Self.lifetime)
    }

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

    func isExpired(at date: Date = .now) -> Bool {
        expiresAt <= date
    }
}
