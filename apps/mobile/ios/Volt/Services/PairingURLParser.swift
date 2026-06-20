import Foundation

enum PairingURLParser {
    static func parse(_ url: URL) -> (PairingSession?, CaptureMode?) {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = Dictionary(uniqueKeysWithValues: (components?.queryItems ?? []).compactMap { item in
            item.value.map { (item.name, $0) }
        })

        let mode = mode(from: query["mode"]) ?? mode(from: url)
        let session = PairingSession(
            token: query["token"] ?? query["joinToken"] ?? joinToken(from: url),
            sessionId: query["sessionId"] ?? query["session"],
            attemptId: query["joinAttemptId"],
            offer: query["offer"],
            answerURL: query["answerUrl"].flatMap(URL.init(string:)),
            sourceURL: url
        )

        return (session.isPresent ? session : nil, mode)
    }

    static func pairingURL(in text: String) -> URL? {
        text
            .components(separatedBy: .whitespacesAndNewlines)
            .lazy
            .compactMap(normalizedURL(from:))
            .first { parse($0).0 != nil }
    }

    private static func mode(from value: String?) -> CaptureMode? {
        guard let value else { return nil }
        return CaptureMode(rawValue: value)
    }

    private static func mode(from url: URL) -> CaptureMode? {
        let candidates = [url.host].compactMap { $0 } + url.pathComponents.filter { $0 != "/" }
        return candidates.compactMap(CaptureMode.init(rawValue:)).first
    }

    private static func joinToken(from url: URL) -> String? {
        guard url.host == ScannerProtocol.signalURL.host else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count >= 4, parts[0] == "api", parts[1] == "signal", parts[2] == "join-token" else { return nil }
        return parts[3]
    }

    private static func normalizedURL(from rawValue: String) -> URL? {
        let urlBoundaryCharacters = CharacterSet(charactersIn: "\"'<>[](){}")
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines.union(urlBoundaryCharacters))
        return URL(string: trimmed)
    }
}
