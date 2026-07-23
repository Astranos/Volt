import Foundation

enum MobileAccessError: LocalizedError, Sendable {
    case invalidResponse
    case rejected(statusCode: Int, detail: String?)
    case signInRequired
    case missingAppAccountToken

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "Volt could not read the access response."
        case .rejected(let statusCode, let detail):
            if let detail, !detail.isEmpty {
                "Volt access was rejected (\(statusCode)): \(detail)"
            } else {
                "Volt access was rejected (\(statusCode))."
            }
        case .signInRequired:
            "Sign in to manage a Volt subscription."
        case .missingAppAccountToken:
            "Volt could not prepare this account for an App Store purchase."
        }
    }
}
