import Foundation

enum KioskCategory: String, Codable, CaseIterable, Identifiable, Sendable {
    case phones = "Phones", computers = "Computers", tablets = "Tablets"
    case gaming = "Gaming", audio = "Audio", cameras = "Cameras", other = "Other"

    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .phones: "iphone"
        case .computers: "laptopcomputer"
        case .tablets: "ipad"
        case .gaming: "gamecontroller"
        case .audio: "headphones"
        case .cameras: "camera"
        case .other: "shippingbox"
        }
    }
}
