import Foundation

enum KioskConfiguration {
    static var apiBaseURL: URL? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "KioskAPIBaseURL") as? String,
              let url = URL(string: value), url.scheme == "https",
              url.host?.isEmpty == false, url.user == nil, url.password == nil,
              url.port == nil || url.port == 443,
              url.path.isEmpty || url.path == "/", url.query == nil, url.fragment == nil else { return nil }
        return url
    }

    static var defaultStoreSlug: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "KioskDefaultStoreSlug") as? String else { return nil }
        return StoreAddress.slug(from: value)
    }
}
