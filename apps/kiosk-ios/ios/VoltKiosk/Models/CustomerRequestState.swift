import Foundation

enum CustomerRequestState: Equatable, Sendable {
    case idle
    case sending
    case sent(KioskRequestReceipt)
    case failed(String)
}
