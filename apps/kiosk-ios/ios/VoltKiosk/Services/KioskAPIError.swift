import Foundation

enum KioskAPIError: LocalizedError, Sendable {
    case invalidConfiguration
    case invalidResponse
    case server(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration: "Ask staff to check the app’s server configuration."
        case .invalidResponse: "The store returned unexpected data. Try again or ask an associate."
        case .server(_, let message): message
        }
    }
}
