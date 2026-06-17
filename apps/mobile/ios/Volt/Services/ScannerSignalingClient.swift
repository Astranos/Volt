import Foundation
import UIKit

struct ScannerSignalingClient {
    struct ReconnectJoinWindow {
        let token: String
        let sessionId: String?
        let sourceURL: URL
    }

    func registerPairing(_ pairing: ScannerProtocol.SessionReady.Pairing, phoneDeviceId: String) async {
        let phoneLabel = await MainActor.run { UIDevice.current.name }
        var request = URLRequest(url: ScannerProtocol.signalURL.appending(path: "pairings"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "pairingId": pairing.pairingId,
            "pairingSecret": pairing.pairingSecret,
            "browserSessionId": pairing.browserSessionId,
            "displayName": pairing.displayName ?? "Chrome session",
            "phoneDeviceId": phoneDeviceId,
            "phoneLabel": phoneLabel,
        ])
        _ = try? await URLSession.shared.data(for: request)
    }

    func requestReconnect(pairingId: String, pairingSecret: String) async throws -> ReconnectJoinWindow {
        let requestId = try await createReconnectRequest(pairingId: pairingId, pairingSecret: pairingSecret)
        let deadline = ContinuousClock.now + ScannerProtocol.joinAttemptTTL
        let statusURL = ScannerProtocol.signalURL
            .appending(path: "pairings")
            .appending(path: pairingId)
            .appending(path: "reconnect")
            .appending(path: requestId)

        while ContinuousClock.now < deadline {
            var request = URLRequest(url: statusURL)
            request.setValue(pairingSecret, forHTTPHeaderField: "X-Volt-Pairing-Secret")
            let (data, response) = try await URLSession.shared.data(for: request)
            let statusCode = (response as? HTTPURLResponse)?.statusCode
            guard statusCode == 200 else {
                if statusCode == 403 {
                    throw ScannerPairingError.requestFailed
                }
                if statusCode == 410 {
                    throw ScannerPairingError.joinTokenExpired
                }
                throw ScannerPairingError.requestFailed
            }
            let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            let reconnectRequest = payload["request"] as? [String: Any] ?? payload
            if reconnectRequest["status"] as? String == "join_window_ready",
               let joinToken = reconnectRequest["joinToken"] as? String {
                return ReconnectJoinWindow(
                    token: joinToken,
                    sessionId: reconnectRequest["sessionId"] as? String,
                    sourceURL: (reconnectRequest["joinUrl"] as? String).flatMap(URL.init(string:)) ?? statusURL
                )
            }
            if reconnectRequest["status"] as? String == "expired" {
                throw ScannerPairingError.joinTokenExpired
            }
            try await Task.sleep(for: ScannerProtocol.joinAttemptPollInterval)
        }
        throw ScannerPairingError.chromeTimedOut
    }

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
        let statusCode = (response as? HTTPURLResponse)?.statusCode
        guard statusCode == 200 else {
            if statusCode == 410 {
                throw ScannerPairingError.joinTokenExpired
            }
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
            let statusCode = (response as? HTTPURLResponse)?.statusCode
            if statusCode == 410 {
                throw ScannerPairingError.joinTokenExpired
            }
            if statusCode == 200,
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
        let statusCode = (response as? HTTPURLResponse)?.statusCode
        guard statusCode == 200 else {
            if statusCode == 410 {
                throw ScannerPairingError.joinTokenExpired
            }
            throw ScannerPairingError.requestFailed
        }
    }

    private func createReconnectRequest(pairingId: String, pairingSecret: String) async throws -> String {
        var request = URLRequest(
            url: ScannerProtocol.signalURL
                .appending(path: "pairings")
                .appending(path: pairingId)
                .appending(path: "reconnect")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(pairingSecret, forHTTPHeaderField: "X-Volt-Pairing-Secret")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["pairingSecret": pairingSecret])

        let (data, response) = try await URLSession.shared.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode
        guard statusCode == 200 else {
            if statusCode == 410 {
                throw ScannerPairingError.joinTokenExpired
            }
            throw ScannerPairingError.requestFailed
        }
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let reconnectRequest = payload["request"] as? [String: Any] ?? payload
        guard let requestId = reconnectRequest["id"] as? String else {
            throw ScannerPairingError.requestFailed
        }
        return requestId
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
