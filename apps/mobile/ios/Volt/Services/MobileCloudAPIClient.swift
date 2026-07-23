import Foundation

protocol MobileCloudAPI: Sendable {
    func exchangeEnrollment(_ request: DeviceEnrollmentRequest) async throws -> DeviceEnrollmentResponse
    func putBatch(_ request: PutCloudBatchRequest) async throws -> PutCloudBatchResponse
    func createPhotoUploadURL(_ request: CreatePhotoUploadURLRequest) async throws -> PresignedPhotoUpload
    func uploadPhoto(_ data: Data, using upload: PresignedPhotoUpload) async throws
    func markBatchReady(_ request: MarkCloudBatchReadyRequest) async throws
}

struct MobileCloudAPIClient: MobileCloudAPI {
    enum Endpoint {
        case enrollmentExchange
        case putBatch
        case createPhotoUploadURL
        case markBatchReady

        var path: String {
            switch self {
            case .enrollmentExchange: "api/mobile/enrollment/exchange"
            case .putBatch: "api/mobile/outbox/sync"
            case .createPhotoUploadURL: "api/mobile/photos/upload-url"
            case .markBatchReady: "api/mobile/batches/finalize"
            }
        }
    }

    let baseURL: URL
    private let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func exchangeEnrollment(_ request: DeviceEnrollmentRequest) async throws -> DeviceEnrollmentResponse {
        try await post(request, to: .enrollmentExchange)
    }

    func putBatch(_ request: PutCloudBatchRequest) async throws -> PutCloudBatchResponse {
        try await post(request, to: .putBatch)
    }

    func createPhotoUploadURL(_ request: CreatePhotoUploadURLRequest) async throws -> PresignedPhotoUpload {
        try await post(request, to: .createPhotoUploadURL)
    }

    func uploadPhoto(_ data: Data, using upload: PresignedPhotoUpload) async throws {
        var request = URLRequest(url: upload.url)
        request.httpMethod = "PUT"
        upload.headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
        let (_, response) = try await session.upload(for: request, from: data)
        try validate(response)
    }

    func markBatchReady(_ request: MarkCloudBatchReadyRequest) async throws {
        let _: EmptyCloudResponse = try await post(
            request,
            to: .markBatchReady
        )
    }

    private func post<Request: Encodable & Sendable, Response: Decodable & Sendable>(
        _ body: Request,
        to endpoint: Endpoint
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: endpoint.path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        try validate(response)
        if Response.self == EmptyCloudResponse.self, data.isEmpty {
            guard let empty = EmptyCloudResponse() as? Response else { throw MobileCloudError.invalidResponse }
            return empty
        }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw MobileCloudError.invalidResponse
        }
    }

    private func validate(_ response: URLResponse) throws {
        guard let response = response as? HTTPURLResponse else { throw MobileCloudError.invalidResponse }
        if response.statusCode == 401 || response.statusCode == 403 {
            throw MobileCloudError.credentialRevoked
        }
        guard (200..<300).contains(response.statusCode) else {
            throw MobileCloudError.httpStatus(response.statusCode)
        }
    }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private struct EmptyCloudResponse: Codable, Sendable {}

enum MobileCloudError: LocalizedError, Equatable {
    case credentialRevoked
    case httpStatus(Int)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .credentialRevoked: "This device enrollment was revoked. Scan a new enrollment QR from Chrome."
        case .httpStatus(let status): "Cloud sync failed with status \(status)."
        case .invalidResponse: "Cloud sync returned an invalid response."
        }
    }
}
