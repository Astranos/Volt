import ClerkKit
import Foundation
import Observation

@MainActor
@Observable
final class AccessStore {
    private(set) var status: AccessStatus?
    private(set) var isRefreshing = false
    private(set) var errorMessage: String?

    @ObservationIgnored private let apiClient: MobileAccessAPIClient

    init(apiClient: MobileAccessAPIClient) {
        self.apiClient = apiClient
    }

    func refresh(using clerk: Clerk) async {
        guard clerk.user != nil else {
            status = nil
            errorMessage = nil
            isRefreshing = false
            return
        }

        isRefreshing = true
        defer { isRefreshing = false }

        do {
            status = try await fetchStatus(using: clerk)
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func appAccountToken(using clerk: Clerk) async throws -> UUID {
        let latestStatus = try await fetchStatus(using: clerk)
        status = latestStatus
        guard let token = latestStatus.appAccountToken else {
            throw MobileAccessError.missingAppAccountToken
        }
        return token
    }

    func synchronize(
        signedTransaction: String,
        using clerk: Clerk
    ) async throws {
        let bearerToken = try await freshBearerToken(using: clerk)
        try await apiClient.synchronizeTransaction(
            signedTransaction: signedTransaction,
            bearerToken: bearerToken
        )
        let refreshedBearerToken = try await freshBearerToken(using: clerk)
        status = try await apiClient.fetchStatus(bearerToken: refreshedBearerToken)
        errorMessage = nil
    }

    func reportAuthenticationError(_ error: Error) {
        errorMessage = "Clerk could not complete authentication: \(error.localizedDescription)"
    }

    private func fetchStatus(using clerk: Clerk) async throws -> AccessStatus {
        let bearerToken = try await freshBearerToken(using: clerk)
        return try await apiClient.fetchStatus(bearerToken: bearerToken)
    }

    private func freshBearerToken(using clerk: Clerk) async throws -> String {
        guard clerk.user != nil,
              let token = try await clerk.auth.getToken(
                  .init(
                      template: AppConfiguration.clerkJWTTemplate,
                      skipCache: true
                  )
              )
        else {
            throw MobileAccessError.signInRequired
        }
        return token
    }
}
