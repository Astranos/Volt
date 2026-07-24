import Foundation

enum AppConfiguration {
    static let clerkPublishableKey = "pk_live_Y2xlcmsudm9sdC5qdWFucXVlbmdhLmNvbSQ"
    static let privacyPolicyURL = URL(string: "https://volt-scanner.vercel.app/privacy")!
    static let termsOfUseURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!
    static let defaultStoreKitProductID = "com.volt.mobile.pro.monthly"
    static let defaultAppStoreID = "6771770148"

    static var clerkJWTTemplate: String {
        configuredString(for: "VoltClerkJWTTemplate") ?? "convex"
    }

    static var storeKitProductID: String {
        configuredString(for: "VoltStoreKitProductID") ?? defaultStoreKitProductID
    }

    static var appStoreID: String {
        configuredString(for: "VoltAppStoreID") ?? defaultAppStoreID
    }

    static var convexSiteURL: URL {
        if let configuredValue = configuredString(for: "VoltConvexSiteURL"),
           let configuredURL = URL(string: configuredValue) {
            return configuredURL
        }

        #if DEBUG
        return requiredURL("https://adorable-hornet-19.convex.site")
        #else
        return requiredURL("https://sincere-trout-414.convex.site")
        #endif
    }

    static var convexCloudURL: URL {
        if let configuredValue = configuredString(for: "VoltConvexCloudURL"),
           let configuredURL = URL(string: configuredValue) {
            return configuredURL
        }

        if let configuredSiteValue = configuredString(for: "VoltConvexSiteURL"),
           let derivedURL = URL(string: configuredSiteValue.replacingOccurrences(of: ".convex.site", with: ".convex.cloud")) {
            return derivedURL
        }

        #if DEBUG
        return requiredURL("https://adorable-hornet-19.convex.cloud")
        #else
        return requiredURL("https://sincere-trout-414.convex.cloud")
        #endif
    }

    private static func configuredString(for key: String) -> String? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
            return nil
        }

        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains("$("), !value.contains("REPLACE_ME") else {
            return nil
        }
        return value
    }

    private static func requiredURL(_ value: String) -> URL {
        guard let url = URL(string: value) else {
            fatalError("Invalid bundled Volt URL: \(value)")
        }
        return url
    }
}
