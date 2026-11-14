import Foundation

enum MobileAccessError: LocalizedError, Sendable {
    case invalidResponse
    case rejected(statusCode: Int, detail: String?)
    case signInRequired
    case missingAppAccountToken

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "Donut could not read the access response."
        case .rejected(let statusCode, let detail):
            if let detail, !detail.isEmpty {
                "Donut access was rejected (\(statusCode)): \(detail)"
            } else {
                "Donut access was rejected (\(statusCode))."
            }
        case .signInRequired:
            "Sign in to manage a Donut subscription."
        case .missingAppAccountToken:
            "Donut could not prepare this account for an App Store purchase."
        }
    }
}
