import Foundation

enum StoreAddress {
    private static let legacyStores = [
        "taylormi": "paymore-taylor",
        "southfieldmi": "paymore-southfield",
    ]

    static func canonicalSlug(_ value: String) -> String {
        legacyStores[value] ?? value
    }

    static func slug(from value: String) -> String? {
        let input = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if validSlug(input) { return canonicalSlug(input) }
        guard let url = URLComponents(string: input.contains("://") ? input : "https://" + input),
              url.scheme == "https", url.user == nil, url.password == nil, url.port == nil,
              url.query == nil, url.fragment == nil, let host = url.host else { return nil }
        let handle: String
        if host.hasSuffix(".myshopify.com"), url.path.isEmpty || url.path == "/" {
            handle = String(host.dropLast(".myshopify.com".count))
        } else if host == "pm.voltresale.app",
                  url.path.range(of: "^/[a-z0-9-]+(?:/requests)?/?$", options: .regularExpression) != nil,
                  let component = url.path.split(separator: "/").first {
            handle = String(component)
        } else {
            return nil
        }
        return validSlug(handle) ? canonicalSlug(handle) : nil
    }

    static func validSlug(_ value: String) -> Bool {
        value.range(of: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", options: .regularExpression) != nil
            && !["www", "api", "admin", "mail", "shop", "localhost"].contains(value)
            && value.range(of: "^[a-z]{2}\\d+$", options: .regularExpression) == nil
    }
}
