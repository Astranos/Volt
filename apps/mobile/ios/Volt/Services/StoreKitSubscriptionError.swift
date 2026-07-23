import Foundation

enum StoreKitSubscriptionError: LocalizedError, Sendable {
    case productUnavailable
    case unverifiedTransaction
    case mismatchedAppAccountToken

    var errorDescription: String? {
        switch self {
        case .productUnavailable:
            "The Volt monthly subscription is not available from the App Store right now."
        case .unverifiedTransaction:
            "The App Store could not verify this transaction."
        case .mismatchedAppAccountToken:
            "The purchase was not associated with the signed-in Volt account."
        }
    }
}
