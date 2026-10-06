import Foundation

struct KioskStore: Codable, Equatable, Sendable, Identifiable {
    let slug: String
    let name: String
    let region: String
    let address: String
    let storefrontUrl: URL
    var id: String { slug }
}
