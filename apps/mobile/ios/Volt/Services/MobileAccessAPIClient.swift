import Foundation

actor MobileAccessAPIClient {
    private let baseURL: URL
    private let urlSession: URLSession

    init(baseURL: URL, urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.urlSession = urlSession
    }

    func fetchStatus(bearerToken: String) async throws -> AccessStatus {
        var request = URLRequest(url: baseURL.appending(path: "api/access/status"))
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data = try await responseData(for: request)
        return try accessDecoder.decode(AccessStatus.self, from: data)
    }

    func synchronizeTransaction(
        signedTransaction: String,
        bearerToken: String
    ) async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/storekit/transactions"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["signedTransaction": signedTransaction])
        _ = try await responseData(for: request)
    }

    private var accessDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }

    private func responseData(for request: URLRequest) async throws -> Data {
        let (data, response) = try await urlSession.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw MobileAccessError.invalidResponse
        }
        guard (200..<300).contains(response.statusCode) else {
            throw MobileAccessError.rejected(
                statusCode: response.statusCode,
                detail: Self.errorDetail(from: data)
            )
        }
        return data
    }

    private static func errorDetail(from data: Data) -> String? {
        let payload = try? JSONDecoder().decode(MobileAccessErrorResponse.self, from: data)
        return payload?.error ?? payload?.detail
    }
}
