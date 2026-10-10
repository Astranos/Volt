import Foundation

struct KioskProductRequest: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let storeSlug: String
    let productId: String
    let variantId: String
    let title: String
    let variantTitle: String
    let sku: String?
    let imageUrl: URL?
    let priceCents: Int
    let productUrl: URL
    let status: KioskRequestStatus
    let createdAt: Double
    let updatedAt: Double
    let expiresAt: Double
}
