import Foundation

enum KioskRequestStatus: String, Codable, CaseIterable, Sendable {
    case waiting, found, shown, given, cleared
    var isActive: Bool { self == .waiting || self == .found }
}
