import Foundation

struct KioskProduct: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let category: KioskCategory
    let condition: String
    let priceCents: Int
    let priceMaxCents: Int
    let images: [URL]
    let url: URL
    let description: String
    let details: [ListingBlock]
    let publishedAt: Date
    let variants: [Variant]

    struct Variant: Codable, Equatable, Identifiable, Sendable {
        let id: String
        let title: String
        let priceCents: Int
        let sku: String?
        var formattedPrice: String { KioskProduct.money(priceCents) }
    }

    var formattedPrice: String {
        (priceMaxCents > priceCents ? "From " : "") + Self.money(priceCents)
    }

    static func money(_ cents: Int) -> String {
        (Decimal(cents) / 100).formatted(.currency(code: "USD").precision(.fractionLength(cents.isMultiple(of: 100) ? 0 : 2)))
    }
}
