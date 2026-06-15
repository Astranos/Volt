import Foundation

struct ScannerSignalingClient {
    func createJoinAttempt(token: String, contributorId: String) async throws -> ScannerProtocol.JoinAttempt {
        let tokenPath = token.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? token
        let url = ScannerProtocol.signalURL
            .appending(path: "join-token")
            .appending(path: tokenPath)
            .appending(path: "attempt")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "contributorId": contributorId,
            "deviceLabel": "iPhone",
            "protocolVersion": "1.0.0",
            "capabilities": ["ocr", "barcode", "dictation", "photo", "photo_retry_queue"],
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw ScannerPairingError.requestFailed
        }
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let attempt = payload["attempt"] as? [String: Any] ?? payload
        let id = attempt["id"] as? String ?? attempt["attemptId"] as? String
        guard let id else {
            throw ScannerPairingError.requestFailed
        }
        return ScannerProtocol.JoinAttempt(
            attemptId: id,
            pollURL: ScannerProtocol.signalURL
                .appending(path: "join-token")
                .appending(path: tokenPath)
                .appending(path: "attempt")
                .appending(path: id)
                .appending(path: "offer"),
            answerURL: ScannerProtocol.signalURL
                .appending(path: "join-token")
                .appending(path: tokenPath)
                .appending(path: "attempt")
                .appending(path: id)
                .appending(path: "answer"),
            sessionId: nil
        )
    }

    func pollOffer(token: String, attempt: ScannerProtocol.JoinAttempt) async throws -> (offer: String, answerURL: URL, sessionId: String?) {
        let deadline = ContinuousClock.now + ScannerProtocol.joinAttemptTTL
        while ContinuousClock.now < deadline {
            let (data, response) = try await URLSession.shared.data(from: attempt.pollURL)
            if (response as? HTTPURLResponse)?.statusCode == 200,
               let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let offer = payload["offer"] as? String ?? payload["sdp"] as? String {
                return (offer.trimmedPairingPayload, attempt.answerURL, payload["sessionId"] as? String ?? attempt.sessionId ?? token)
            }
            try await Task.sleep(for: ScannerProtocol.joinAttemptPollInterval)
        }
        throw ScannerPairingError.chromeTimedOut
    }

    func postAnswer(_ answer: ScannerProtocol.SessionDescription, to answerURL: URL) async throws {
        var request = URLRequest(url: answerURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "answer": String(data: try JSONEncoder.scanner.encode(answer), encoding: .utf8) ?? "",
        ])

        let (_, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw ScannerPairingError.requestFailed
        }
    }
}

private extension String {
    var trimmedPairingPayload: String {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("{"),
           let data = trimmed.data(using: .utf8),
           let description = try? JSONDecoder().decode(ScannerProtocol.SessionDescription.self, from: data),
           let encoded = try? ScannerProtocol.encodePairingPayload(description) {
            return encoded
        }
        return trimmed
    }
}
