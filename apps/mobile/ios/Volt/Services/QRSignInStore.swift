import ClerkKit
import Foundation
import Observation
import OSLog

/// Signs the app in with a QR code from signed-in Chrome.
///
/// The phone sends an email, every signed-in Chrome for that account shows a
/// notification, and the clicked computer shows a one-time QR. The QR only
/// works together with the request secret this store keeps in memory, so a
/// photo of the screen is useless on any other phone.
@MainActor
@Observable
final class QRSignInStore {
    enum Phase: Equatable {
        case enteringEmail
        case requesting
        case waitingForScan(expiresAt: Date)
        case signingIn
    }

    static let signInHosts: Set<String> = ["donut.juanquenga.com", "voltresale.app"]
    static let signInPath = "/app-sign-in"
    private static let emailDefaultsKey = "volt.qrSignIn.lastEmail"
    private static let logger = Logger(subsystem: "com.volt.mobile", category: "QRSignIn")

    var isPresented = false
    var email: String
    private(set) var phase: Phase = .enteringEmail
    private(set) var errorMessage: String?
    private(set) var scanHint: String?

    @ObservationIgnored private let apiClient: MobileSignInAPIClient
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var requestSecret: String?

    init(apiClient: MobileSignInAPIClient, defaults: UserDefaults = .standard) {
        self.apiClient = apiClient
        self.defaults = defaults
        email = defaults.string(forKey: Self.emailDefaultsKey) ?? ""
    }

    var canSubmit: Bool {
        phase != .requesting && Self.normalizedEmail(email) != nil
    }

    func present() {
        if case .waitingForScan(let expiresAt) = phase, expiresAt <= .now {
            startOver(message: "That request expired. Send a new one.")
        }
        isPresented = true
    }

    func requestSignIn() async {
        guard let normalized = Self.normalizedEmail(email), phase != .requesting else {
            errorMessage = "Enter the email you use for Donut."
            return
        }
        email = normalized
        defaults.set(normalized, forKey: Self.emailDefaultsKey)
        errorMessage = nil
        scanHint = nil
        phase = .requesting
        do {
            let request = try await apiClient.requestSignIn(email: normalized)
            requestSecret = request.requestSecret
            phase = .waitingForScan(expiresAt: request.expiresAt)
        } catch {
            requestSecret = nil
            phase = .enteringEmail
            errorMessage = Self.message(for: error)
        }
    }

    /// Handles a value from the in-app scanner. Returns true once it has been
    /// accepted, so the scanner can pause.
    @discardableResult
    func handleScannedValue(_ value: String, clerk: Clerk) async -> Bool {
        guard case .waitingForScan = phase else { return false }
        guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            scanHint = "That isn't a Donut sign-in QR code."
            return false
        }
        if Self.isAppClipURL(url) {
            scanHint = "That's the App Clip QR. Click the Donut notification in Chrome to show the sign-in QR."
            return false
        }
        guard let code = Self.signInCode(from: url) else {
            scanHint = "That isn't a Donut sign-in QR code."
            return false
        }
        await redeem(code: code, clerk: clerk)
        return true
    }

    /// Handles a sign-in link opened from the Camera app. Returns true when the
    /// URL was a sign-in link, whether or not it could be used.
    func handleIncomingURL(_ url: URL, clerk: Clerk) -> Bool {
        guard let code = Self.signInCode(from: url) else { return false }
        // Never switch accounts from a link.
        guard clerk.user == nil else { return true }
        isPresented = true
        guard case .waitingForScan = phase, requestSecret != nil else {
            startOver(message: "Enter your email first, then scan the QR code Chrome shows.")
            return true
        }
        Task { await redeem(code: code, clerk: clerk) }
        return true
    }

    func startOver(message: String? = nil) {
        requestSecret = nil
        scanHint = nil
        errorMessage = message
        phase = .enteringEmail
    }

    private func redeem(code: String, clerk: Clerk) async {
        guard let requestSecret, case .waitingForScan(let expiresAt) = phase else { return }
        scanHint = nil
        phase = .signingIn
        do {
            let ticket = try await apiClient.redeem(requestSecret: requestSecret, code: code)
            let signIn = try await clerk.auth.signInWithTicket(ticket)
            guard signIn.status == .complete, let sessionId = signIn.createdSessionId else {
                startOver(message: "This account needs regular sign-in. Use Sign in instead.")
                return
            }
            if clerk.client?.lastActiveSessionId != sessionId {
                try await clerk.auth.setActive(sessionId: sessionId)
            }
            self.requestSecret = nil
            phase = .enteringEmail
            isPresented = false
        } catch MobileSignInAPIError.rejected(_, .some("invalid_code")) {
            // Usually a QR shown for an older request; this request is still open.
            phase = .waitingForScan(expiresAt: expiresAt)
            scanHint = "That QR code is for a different request. Reopen the QR from the Chrome notification."
        } catch {
            let failure = error as NSError
            Self.logger.error("QR sign-in failed: \(failure.domain, privacy: .public) \(failure.code)")
            startOver(message: Self.message(for: error))
        }
    }

    static func normalizedEmail(_ value: String) -> String? {
        let email = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard email.count <= 320,
              email.wholeMatch(of: /[^\s@]+@[^\s@]+\.[^\s@]+/) != nil else { return nil }
        return email
    }

    /// `https://donut.juanquenga.com/app-sign-in#code=…` → the code. The code rides in
    /// the fragment so it never reaches a web server.
    static func signInCode(from url: URL) -> String? {
        guard url.scheme == "https",
              let host = url.host()?.lowercased(),
              signInHosts.contains(host),
              url.path().trimmingTrailingSlash == signInPath,
              let fragment = url.fragment(),
              let code = URLComponents(string: "?\(fragment)")?
                .queryItems?
                .first(where: { $0.name == "code" })?
                .value,
              !code.isEmpty,
              code.count <= 128 else { return nil }
        return code
    }

    static func isAppClipURL(_ url: URL) -> Bool {
        guard let host = url.host()?.lowercased() else { return false }
        return signInHosts.contains(host) && url.path().hasPrefix("/clip")
    }

    private static func message(for error: Error) -> String {
        switch error {
        case MobileSignInAPIError.rejected(429, _):
            return "Too many sign-in requests. Wait a few minutes and try again."
        case MobileSignInAPIError.rejected(_, .some("invalid_email")):
            return "Enter the email you use for Donut."
        case MobileSignInAPIError.rejected(_, .some("request_expired")):
            return "That request expired or was declined in Chrome. Send a new one."
        case MobileSignInAPIError.rejected(_, .some("account_not_allowed")):
            return "This account can't use QR sign-in. Use Sign in instead."
        case is URLError:
            return "Couldn't reach Donut. Check your connection and try again."
        default:
            return "QR sign-in didn't work. Try again, or use Sign in instead."
        }
    }
}

private extension String {
    var trimmingTrailingSlash: String {
        count > 1 && hasSuffix("/") ? String(dropLast()) : self
    }
}

enum MobileSignInAPIError: Error, Equatable {
    case invalidResponse
    case rejected(statusCode: Int, code: String?)
}

private struct MobileSignInFailure: Decodable {
    let error: String?
}

struct MobileSignInRequest: Equatable, Sendable {
    let requestSecret: String
    let expiresAt: Date
}

actor MobileSignInAPIClient {
    private let baseURL: URL
    private let urlSession: URLSession

    init(baseURL: URL, urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.urlSession = urlSession
    }

    func requestSignIn(email: String) async throws -> MobileSignInRequest {
        struct Response: Decodable { let requestSecret: String; let expiresAt: Double }
        let response: Response = try await post("api/mobile/sign-in/request", body: ["email": email])
        return MobileSignInRequest(
            requestSecret: response.requestSecret,
            expiresAt: Date(timeIntervalSince1970: response.expiresAt / 1_000)
        )
    }

    func redeem(requestSecret: String, code: String) async throws -> String {
        struct Response: Decodable { let ticket: String }
        let response: Response = try await post(
            "api/mobile/sign-in/redeem",
            body: ["requestSecret": requestSecret, "code": code]
        )
        return response.ticket
    }

    private func post<Response: Decodable>(_ path: String, body: [String: String]) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await urlSession.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw MobileSignInAPIError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            let code = (try? JSONDecoder().decode(MobileSignInFailure.self, from: data))?.error
            throw MobileSignInAPIError.rejected(statusCode: response.statusCode, code: code)
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw MobileSignInAPIError.invalidResponse
        }
    }
}
