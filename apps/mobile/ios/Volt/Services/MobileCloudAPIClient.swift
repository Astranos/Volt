import Foundation

protocol MobileCloudAPI: Sendable {
    func bootstrapDevice(_ request: BootstrapMobileDeviceRequest, bearerToken: String) async throws -> BootstrapMobileDeviceResponse
    func putBatch(_ request: PutCloudBatchRequest) async throws -> PutCloudBatchResponse
    func createPhotoUploadURL(_ request: CreatePhotoUploadURLRequest) async throws -> PresignedPhotoUpload
    func uploadPhoto(_ data: Data, using upload: PresignedPhotoUpload) async throws
    func markBatchReady(_ request: MarkCloudBatchReadyRequest) async throws
    func listComputers(_ request: ListCloudComputersRequest) async throws -> ListCloudComputersResponse
    func setCursorTarget(_ request: SetCursorTargetRequest) async throws -> SetCursorTargetResponse
    func queueCursorDelivery(_ request: QueueCursorDeliveryRequest) async throws -> QueueCursorDeliveryResponse
    func cursorDeliveryStatus(_ request: CursorDeliveryStatusRequest) async throws -> CursorDeliveryStatusResponse
    func analyzeProductImage(
        _ data: Data,
        mode: ProductScanMode,
        deviceId: String,
        deviceSecret: String
    ) async throws -> ProductScanResponse
}

struct MobileCloudAPIClient: MobileCloudAPI {
    enum Endpoint {
        case deviceBootstrap
        case putBatch
        case createPhotoUploadURL
        case markBatchReady
        case listComputers
        case cursorTarget
        case queueCursorDelivery
        case cursorDeliveryStatus

        var path: String {
            switch self {
            case .deviceBootstrap: "api/mobile/devices/bootstrap"
            case .putBatch: "api/mobile/outbox/sync"
            case .createPhotoUploadURL: "api/mobile/photos/upload-url"
            case .markBatchReady: "api/mobile/batches/finalize"
            case .listComputers: "api/mobile/computers/list"
            case .cursorTarget: "api/mobile/cursor-target"
            case .queueCursorDelivery: "api/mobile/deliveries/queue"
            case .cursorDeliveryStatus: "api/mobile/deliveries/status"
            }
        }
    }

    let baseURL: URL
    private let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func bootstrapDevice(
        _ request: BootstrapMobileDeviceRequest,
        bearerToken: String
    ) async throws -> BootstrapMobileDeviceResponse {
        try await post(request, to: .deviceBootstrap, bearerToken: bearerToken)
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

    func listComputers(_ request: ListCloudComputersRequest) async throws -> ListCloudComputersResponse {
        try await post(request, to: .listComputers)
    }

    func setCursorTarget(_ request: SetCursorTargetRequest) async throws -> SetCursorTargetResponse {
        try await post(request, to: .cursorTarget)
    }

    func queueCursorDelivery(_ request: QueueCursorDeliveryRequest) async throws -> QueueCursorDeliveryResponse {
        try await post(request, to: .queueCursorDelivery)
    }

    func cursorDeliveryStatus(_ request: CursorDeliveryStatusRequest) async throws -> CursorDeliveryStatusResponse {
        try await post(request, to: .cursorDeliveryStatus)
    }

    func analyzeProductImage(
        _ data: Data,
        mode: ProductScanMode,
        deviceId: String,
        deviceSecret: String
    ) async throws -> ProductScanResponse {
        var components = URLComponents(
            url: baseURL.appending(path: "api/mobile/ai/analyze"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "mode", value: mode.rawValue)]
        guard let url = components?.url else { throw MobileCloudError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(deviceId, forHTTPHeaderField: "X-Volt-Device-Id")
        request.setValue(deviceSecret, forHTTPHeaderField: "X-Volt-Device-Secret")
        let (responseData, response) = try await session.upload(for: request, from: data)
        try validate(response)
        do {
            return try Self.decoder.decode(ProductScanResponse.self, from: responseData)
        } catch {
            throw MobileCloudError.invalidResponse
        }
    }

    private func post<Request: Encodable & Sendable, Response: Decodable & Sendable>(
        _ body: Request,
        to endpoint: Endpoint,
        bearerToken: String? = nil
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: endpoint.path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
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
        if response.statusCode == 402 {
            throw MobileCloudError.paidSubscriptionRequired
        }
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
    case paidSubscriptionRequired
    case httpStatus(Int)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .credentialRevoked: "This device credential is no longer valid. Sign in again to reconnect it."
        case .paidSubscriptionRequired: "A paid Volt subscription is required for AI product scanning."
        case .httpStatus(let status): "Cloud sync failed with status \(status)."
        case .invalidResponse: "Cloud sync returned an invalid response."
        }
    }
}
