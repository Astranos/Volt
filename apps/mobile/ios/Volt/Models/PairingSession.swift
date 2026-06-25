import Foundation

struct PairingSession: Equatable {
    var token: String?
    var sessionId: String?
    var attemptId: String?
    var offer: String?
    var answerURL: URL?
    var label: String?
    var signalURL: URL?
    var sourceURL: URL

    var isPresent: Bool {
        token != nil || offer != nil || sessionId != nil
    }
}
