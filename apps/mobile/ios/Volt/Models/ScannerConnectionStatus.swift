import Foundation

enum ScannerConnectionStatus: Equatable {
    case idle
    case pairing
    case waitingForChrome
    case connected
    case disconnected
    case error(String)

    var isConnected: Bool {
        if case .connected = self { true } else { false }
    }
}
