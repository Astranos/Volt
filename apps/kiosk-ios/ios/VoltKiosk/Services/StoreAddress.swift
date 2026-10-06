import Foundation

enum StoreAddress {
    static func slug(from value: String) -> String? {
        let input = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if validSlug(input) { return input }
        guard let url = URLComponents(string: input.contains("://") ? input : "https://" + input),
              url.scheme == "https", url.user == nil, url.password == nil, url.port == nil,
              url.path.isEmpty || url.path == "/", url.query == nil, url.fragment == nil,
              let host = url.host, host.hasSuffix(".paymore.com") else { return nil }
        let slug = String(host.dropLast(".paymore.com".count))
        return validSlug(slug) ? slug : nil
    }

    static func validSlug(_ value: String) -> Bool {
        value.range(of: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", options: .regularExpression) != nil
    }
}
