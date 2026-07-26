import Foundation

struct PairingSession: Equatable {
    var token: String?
    var sessionId: String?
    var attemptId: String?
    var offer: String?
    var answerURL: URL?
    var label: String?
    var signalURL: URL?
    var cloudURL: URL? = nil
    var guestCloudGrant: String? = nil
    var guestCloudExpiresAt: Date? = nil
    var sourceURL: URL

    var isPresent: Bool {
        token != nil || offer != nil || sessionId != nil || guestCloudGrant != nil
    }
}
