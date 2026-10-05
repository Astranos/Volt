import Foundation

/// Restrict document navigation to the bundled portal's exact HTTPS origin.
struct PortalNavigationPolicy {
    let portalURL: URL

    init?(portalURL: URL) {
        guard Self.isSecureWebURL(portalURL) else { return nil }
        self.portalURL = portalURL
    }

    func allows(_ url: URL?) -> Bool {
        guard let url, Self.isSecureWebURL(url) else { return false }
        return url.host?.lowercased() == portalURL.host?.lowercased()
            && (url.port ?? 443) == (portalURL.port ?? 443)
    }

    private static func isSecureWebURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https"
            && url.host?.isEmpty == false
            && url.user == nil
            && url.password == nil
            && (url.port == nil || url.port == 443)
    }
}
