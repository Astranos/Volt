import Foundation

@main
struct PortalNavigationPolicyTests {
    static func main() {
        let policy = PortalNavigationPolicy(portalURL: URL(string: "https://pm.juanquenga.com/taylormi")!)!
        let allowed = [
            "https://pm.juanquenga.com",
            "https://pm.juanquenga.com/taylormi?search=phone#products",
            "https://pm.juanquenga.com/southfieldmi/requests",
            "https://PM.JUANQUENGA.COM:443/taylormi"
        ]
        let blocked = [
            "http://pm.juanquenga.com",
            "https://pm.juanquenga.com:8443/taylormi",
            "https://pm.juanquenga.com.evil.example",
            "https://evil.pm.juanquenga.com",
            "https://pm.juanquenga.com@evil.example",
            "https://user@pm.juanquenga.com",
            "https://user:password@pm.juanquenga.com",
            "https://taylormi.paymore.com",
            "https://example.com",
            "javascript:alert(1)",
            "data:text/html,hello",
            "file:///tmp/page.html",
            "about:blank",
            "mailto:staff@example.com",
            "tel:5551234567",
            "itms-apps://apps.apple.com/app/example"
        ]
        for value in allowed {
            precondition(policy.allows(URL(string: value)), "Expected allowed: \(value)")
        }
        for value in blocked {
            precondition(!policy.allows(URL(string: value)), "Expected blocked: \(value)")
        }
        precondition(!policy.allows(nil))
        for value in ["http://pm.juanquenga.com", "https://user@pm.juanquenga.com", "file:///tmp/page", "https://pm.juanquenga.com:8443"] {
            precondition(PortalNavigationPolicy(portalURL: URL(string: value)!) == nil)
        }
        print("Portal policy passed: exact HTTPS origin, deceptive hosts, credentials, ports, and external app schemes.")
    }
}
