import Foundation
import UIKit

struct ScannerSignalingClient: Sendable {
    struct ReconnectJoinWindow: Sendable {
        let token: String
        let sessionId: String?
        let sourceURL: URL
    }

    private struct ReconnectStatusRequest: Sendable {
        let requestId: String
        let statusURL: URL
    }

    private enum ReconnectRequestCreationResult: Sendable {
        case success(ReconnectStatusRequest)
        case failure
    }

    func fetchIceServerConfiguration(signalURL: URL = ScannerProtocol.signalURL) async throws -> ScannerProtocol.IceServerConfiguration {
        var request = URLRequest(url: signalURL.appending(path: "ice-servers"))
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await signalData(for: request)
        try validateSignalResponse(data: data, response: response)

        return try JSONDecoder().decode(ScannerProtocol.IceServerConfiguration.self, from: data)
    }

    func registerPairing(
        _ pairing: ScannerProtocol.SessionReady.Pairing,
        phoneDeviceId: String,
        signalURL: URL = ScannerProtocol.signalURL
    ) async throws {
        try await registerPairing(
            pairingId: pairing.pairingId,
            pairingSecret: pairing.pairingSecret,
            browserSessionId: pairing.browserSessionId,
            displayName: pairing.displayName ?? "Chrome session",
            phoneDeviceId: phoneDeviceId,
            signalURL: signalURL
        )
    }

    func registerPairing(
        pairingId: String,
        pairingSecret: String,
        browserSessionId: String,
        displayName: String,
        phoneDeviceId: String,
        signalURL: URL = ScannerProtocol.signalURL,
        retries: Int = 2,
        timeout: TimeInterval = ScannerProtocol.signalRequestTimeout
    ) async throws {
        let phoneLabel = await MainActor.run { UIDevice.current.name }
        var request = URLRequest(url: signalURL.appending(path: "pairings"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "pairingId": pairingId,
            "pairingSecret": pairingSecret,
            "browserSessionId": browserSessionId,
            "displayName": displayName,
            "phoneDeviceId": phoneDeviceId,
            "phoneLabel": phoneLabel,
        ])
        let (data, response) = try await signalData(for: request, retries: retries, timeout: timeout)
        try validateSignalResponse(data: data, response: response)
    }

    @discardableResult
    func registerPairingCandidates(
        pairingId: String,
        pairingSecret: String,
        browserSessionId: String,
        displayName: String,
        phoneDeviceId: String,
        signalURLs: [URL],
        retries: Int = 0,
        timeout: TimeInterval = ScannerProtocol.reconnectCandidateRequestTimeout
    ) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            for signalURL in signalURLs {
                group.addTask {
                    do {
                        try await registerPairing(
                            pairingId: pairingId,
                            pairingSecret: pairingSecret,
                            browserSessionId: browserSessionId,
                            displayName: displayName,
                            phoneDeviceId: phoneDeviceId,
                            signalURL: signalURL,
                            retries: retries,
                            timeout: timeout
                        )
                        return true
                    } catch {
                        return false
                    }
                }
            }

            var didRegister = false
            for await result in group {
                didRegister = didRegister || result
            }
            return didRegister
        }
    }

    func requestReconnect(
        pairingId: String,
        pairingSecret: String,
        signalURL: URL = ScannerProtocol.signalURL
    ) async throws -> ReconnectJoinWindow {
        try await requestReconnect(
            pairingId: pairingId,
            pairingSecret: pairingSecret,
            signalURLs: [signalURL]
        )
    }

    func requestReconnect(
        pairingId: String,
        pairingSecret: String,
        signalURLs: [URL]
    ) async throws -> ReconnectJoinWindow {
        let isCandidateProbe = signalURLs.count > 1
        let requestRetries = isCandidateProbe ? 0 : 2
        let requestTimeout = isCandidateProbe ? ScannerProtocol.reconnectCandidateRequestTimeout : ScannerProtocol.signalRequestTimeout
        var requests: [ReconnectStatusRequest] = []
        var lastError: ScannerPairingError?
        await withTaskGroup(of: ReconnectRequestCreationResult.self) { group in
            for signalURL in signalURLs {
                group.addTask {
                    do {
                        let requestId = try await createReconnectRequest(
                            pairingId: pairingId,
                            pairingSecret: pairingSecret,
                            signalURL: signalURL,
                            retries: requestRetries,
                            timeout: requestTimeout
                        )
                        return .success(ReconnectStatusRequest(
                            requestId: requestId,
                            statusURL: signalURL
                                .appending(path: "pairings")
                                .appending(path: pairingId)
                                .appending(path: "reconnect")
                                .appending(path: requestId)
                        ))
                    } catch {
                        return .failure
                    }
                }
            }

            for await result in group {
                switch result {
                case .success(let request):
                    requests.append(request)
                case .failure:
                    lastError = ScannerPairingError.requestFailed
                }
            }
        }
        guard !requests.isEmpty else {
            throw lastError ?? ScannerPairingError.requestFailed
        }

        let deadline = ContinuousClock.now + ScannerProtocol.reconnectRequestTTL

        while ContinuousClock.now < deadline {
            for reconnectRequest in requests {
                var request = URLRequest(url: reconnectRequest.statusURL)
                request.setValue(pairingSecret, forHTTPHeaderField: "X-Volt-Pairing-Secret")
                let data: Data
                let response: URLResponse
                do {
                    (data, response) = try await signalData(
                        for: request,
                        retries: 0,
                        timeout: ScannerProtocol.reconnectCandidateRequestTimeout
                    )
                } catch {
                    lastError = ScannerPairingError.requestFailed
                    continue
                }
                let statusCode = (response as? HTTPURLResponse)?.statusCode
                guard statusCode == 200 else {
                    if statusCode == 410 {
                        lastError = ScannerPairingError.joinTokenExpired
                        continue
                    }
                    lastError = signalRejectedError(data: data, statusCode: statusCode)
                    continue
                }
                let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
                let reconnectStatus = payload["request"] as? [String: Any] ?? payload
                if reconnectStatus["status"] as? String == "join_window_ready",
                   let joinToken = reconnectStatus["joinToken"] as? String {
                    return ReconnectJoinWindow(
                        token: joinToken,
                        sessionId: reconnectStatus["sessionId"] as? String,
                        sourceURL: (reconnectStatus["joinUrl"] as? String).flatMap(URL.init(string:)) ?? reconnectRequest.statusURL
                    )
                }
                if reconnectStatus["status"] as? String == "expired" {
                    lastError = ScannerPairingError.joinTokenExpired
                }
            }
            try await Task.sleep(for: ScannerProtocol.joinAttemptPollInterval)
        }
        throw lastError ?? ScannerPairingError.chromeTimedOut
    }

    func createJoinAttempt(
        token: String,
        contributorId: String,
        signalURL: URL = ScannerProtocol.signalURL
    ) async throws -> ScannerProtocol.JoinAttempt {
        let tokenPath = token.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? token
        let url = signalURL
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

        let (data, response) = try await signalData(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode
        guard statusCode == 200 else {
            if statusCode == 410 {
                throw ScannerPairingError.joinTokenExpired
            }
            throw signalRejectedError(data: data, statusCode: statusCode)
        }
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let attempt = payload["attempt"] as? [String: Any] ?? payload
        let id = attempt["id"] as? String ?? attempt["attemptId"] as? String
        guard let id else {
            throw ScannerPairingError.requestFailed
        }
        return ScannerProtocol.JoinAttempt(
            attemptId: id,
            pollURL: signalURL
                .appending(path: "join-token")
                .appending(path: tokenPath)
                .appending(path: "attempt")
                .appending(path: id)
                .appending(path: "offer"),
            answerURL: signalURL
                .appending(path: "join-token")
                .appending(path: tokenPath)
                .appending(path: "attempt")
                .appending(path: id)
                .appending(path: "answer"),
            sessionId: nil
        )
    }

    func createJoinAttemptResolvingSignalURL(
        token: String,
        contributorId: String,
        preferredSignalURL: URL,
        allowFallback: Bool
    ) async throws -> (attempt: ScannerProtocol.JoinAttempt, signalURL: URL) {
        var signalURLs = [preferredSignalURL]
        if allowFallback {
            for fallbackURL in ScannerProtocol.fallbackSignalURLs where !signalURLs.contains(fallbackURL) {
                signalURLs.append(fallbackURL)
            }
        }

        var lastError: Error?
        for signalURL in signalURLs {
            do {
                let attempt = try await createJoinAttempt(
                    token: token,
                    contributorId: contributorId,
                    signalURL: signalURL
                )
                return (attempt, signalURL)
            } catch ScannerPairingError.signalRejected(let statusCode, let detail)
                where statusCode == 404 && detail == "Join token not found" && allowFallback {
                lastError = ScannerPairingError.signalRejected(statusCode: statusCode, detail: detail)
                continue
            } catch {
                throw error
            }
        }

        throw lastError ?? ScannerPairingError.requestFailed
    }

    func pollOffer(token: String, attempt: ScannerProtocol.JoinAttempt) async throws -> (offer: String, answerURL: URL, sessionId: String?) {
        let deadline = ContinuousClock.now + ScannerProtocol.joinAttemptTTL
        while ContinuousClock.now < deadline {
            let (data, response) = try await signalData(from: attempt.pollURL)
            let statusCode = (response as? HTTPURLResponse)?.statusCode
            if statusCode == 410 {
                throw ScannerPairingError.joinTokenExpired
            }
            if statusCode != 200 {
                throw signalRejectedError(data: data, statusCode: statusCode)
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

        let (data, response) = try await signalData(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode
        guard statusCode == 200 else {
            if statusCode == 410 {
                throw ScannerPairingError.joinTokenExpired
            }
            throw signalRejectedError(data: data, statusCode: statusCode)
        }
    }

    private func createReconnectRequest(
        pairingId: String,
        pairingSecret: String,
        signalURL: URL = ScannerProtocol.signalURL,
        retries: Int = 2,
        timeout: TimeInterval = ScannerProtocol.signalRequestTimeout
    ) async throws -> String {
        var request = URLRequest(
            url: signalURL
                .appending(path: "pairings")
                .appending(path: pairingId)
                .appending(path: "reconnect")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(pairingSecret, forHTTPHeaderField: "X-Volt-Pairing-Secret")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["pairingSecret": pairingSecret])

        let (data, response) = try await signalData(for: request, retries: retries, timeout: timeout)
        let statusCode = (response as? HTTPURLResponse)?.statusCode
        guard statusCode == 200 else {
            if statusCode == 410 {
                throw ScannerPairingError.joinTokenExpired
            }
            throw signalRejectedError(data: data, statusCode: statusCode)
        }
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let reconnectRequest = payload["request"] as? [String: Any] ?? payload
        guard let requestId = reconnectRequest["id"] as? String else {
            throw ScannerPairingError.requestFailed
        }
        return requestId
    }

    private func signalData(
        from url: URL,
        retries: Int = 2,
        timeout: TimeInterval = ScannerProtocol.signalRequestTimeout
    ) async throws -> (Data, URLResponse) {
        try await signalData(for: URLRequest(url: url), retries: retries, timeout: timeout)
    }

    private func signalData(
        for request: URLRequest,
        retries: Int = 2,
        timeout: TimeInterval = ScannerProtocol.signalRequestTimeout
    ) async throws -> (Data, URLResponse) {
        var request = request
        request.timeoutInterval = timeout

        for attempt in 0...retries {
            do {
                let result = try await URLSession.shared.data(for: request)
                if attempt < retries,
                   let statusCode = (result.1 as? HTTPURLResponse)?.statusCode,
                   isRetryableSignalStatus(statusCode) {
                    try await Task.sleep(for: signalRetryDelay(attempt: attempt))
                    continue
                }
                return result
            } catch {
                guard attempt < retries else { throw error }
                try await Task.sleep(for: signalRetryDelay(attempt: attempt))
            }
        }

        throw ScannerPairingError.requestFailed
    }

    private func isRetryableSignalStatus(_ statusCode: Int) -> Bool {
        statusCode == 408 || statusCode == 429 || statusCode >= 500
    }

    private func signalRetryDelay(attempt: Int) -> Duration {
        .milliseconds(250 * (1 << attempt))
    }

    private func validateSignalResponse(data: Data, response: URLResponse) throws {
        let statusCode = (response as? HTTPURLResponse)?.statusCode
        guard statusCode == 200 else {
            throw signalRejectedError(data: data, statusCode: statusCode)
        }
    }

    private func signalRejectedError(data: Data, statusCode: Int?) -> ScannerPairingError {
        ScannerPairingError.signalRejected(
            statusCode: statusCode ?? -1,
            detail: signalErrorDetail(data)
        )
    }

    private func signalErrorDetail(_ data: Data) -> String? {
        guard !data.isEmpty,
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return payload["error"] as? String
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
