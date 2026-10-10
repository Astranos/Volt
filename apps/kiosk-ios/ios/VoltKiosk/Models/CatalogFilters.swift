import Foundation

struct CatalogFilters: Equatable, Sendable {
    var query = ""
    var category: KioskCategory?
    var budgetCents = 0
    var sort = Sort.newest

    enum Sort: String, CaseIterable, Identifiable, Sendable {
        case newest = "Newest first", low = "Price: low to high", high = "Price: high to low"
        var id: String { rawValue }
    }

    func apply(to products: [KioskProduct]) -> [KioskProduct] {
        let words = query.lowercased().split(whereSeparator: \.isWhitespace)
        return products.filter { product in
            let text = ([product.title, product.category.rawValue, product.description] + product.variants.compactMap(\.sku)).joined(separator: " ").lowercased()
            return (category == nil || category == product.category)
                && (budgetCents == 0 || product.priceCents <= budgetCents)
                && words.allSatisfy { text.contains($0) }
        }.sorted { first, second in
            switch sort {
            case .newest: first.publishedAt == second.publishedAt ? first.id < second.id : first.publishedAt > second.publishedAt
            case .low: first.priceCents == second.priceCents ? first.id < second.id : first.priceCents < second.priceCents
            case .high: first.priceCents == second.priceCents ? first.id < second.id : first.priceCents > second.priceCents
            }
        }
    }
}
