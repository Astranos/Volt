import Foundation

struct DeviceEnrollment: Equatable, Sendable {
    let token: String
}

enum EnrollmentURLParser {
    static func parse(_ url: URL) -> DeviceEnrollment? {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let queryToken = components?.queryItems?.first {
            $0.name == "enrollmentToken" || $0.name == "enrollment_token"
        }?.value
        let pathToken = tokenFromPath(url)
        guard let token = queryToken ?? pathToken else { return nil }
        return enrollment(token: token)
    }

    static func enrollment(in text: String) -> DeviceEnrollment? {
        text
            .components(separatedBy: .whitespacesAndNewlines)
            .lazy
            .compactMap { URL(string: $0.trimmingCharacters(in: CharacterSet(charactersIn: "\"'<>[](){}"))) }
            .compactMap(parse)
            .first
    }

    private static func enrollment(token: String) -> DeviceEnrollment? {
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard token.count >= 20, !looksLikeJWT(token) else { return nil }
        return DeviceEnrollment(token: token)
    }

    private static func tokenFromPath(_ url: URL) -> String? {
        let parts = url.pathComponents.filter { $0 != "/" }
        guard let enrollmentIndex = parts.firstIndex(of: "enroll"),
              parts.indices.contains(enrollmentIndex + 1)
        else { return nil }
        return parts[enrollmentIndex + 1]
    }

    private static func looksLikeJWT(_ value: String) -> Bool {
        value.split(separator: ".", omittingEmptySubsequences: false).count == 3
    }
}
