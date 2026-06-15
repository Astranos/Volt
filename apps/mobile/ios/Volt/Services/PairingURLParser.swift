import Foundation

enum PairingURLParser {
    static func parse(_ url: URL) -> (PairingSession?, CaptureMode?) {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = Dictionary(uniqueKeysWithValues: (components?.queryItems ?? []).compactMap { item in
            item.value.map { (item.name, $0) }
        })

        let mode = mode(from: query["mode"]) ?? mode(from: url)
        let session = PairingSession(
            token: query["token"],
            sessionId: query["sessionId"] ?? query["session"],
            attemptId: query["joinAttemptId"],
            offer: query["offer"],
            answerURL: query["answerUrl"].flatMap(URL.init(string:)),
            sourceURL: url
        )

        return (session.isPresent ? session : nil, mode)
    }

    private static func mode(from value: String?) -> CaptureMode? {
        guard let value else { return nil }
        return CaptureMode(rawValue: value)
    }

    private static func mode(from url: URL) -> CaptureMode? {
        let candidates = [url.host].compactMap { $0 } + url.pathComponents.filter { $0 != "/" }
        return candidates.compactMap(CaptureMode.init(rawValue:)).first
    }
}
