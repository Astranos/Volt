import Foundation

struct AppClipGuestCloudSession: Sendable, Equatable {
    let grant: String
    let baseURL: URL
    let expiresAt: Date?

    init?(pairingSession: PairingSession) {
        guard let grant = pairingSession.guestCloudGrant?.trimmingCharacters(in: .whitespacesAndNewlines),
              !grant.isEmpty,
              let cloudURL = pairingSession.cloudURL
                ?? pairingSession.signalURL
                ?? pairingSession.sourceURL.signalBaseURL,
              var components = URLComponents(url: cloudURL, resolvingAgainstBaseURL: false)
        else { return nil }

        components.path = "/"
        components.query = nil
        components.fragment = nil
        guard let baseURL = components.url else { return nil }
        self.grant = grant
        self.baseURL = baseURL
        expiresAt = pairingSession.guestCloudExpiresAt
    }

    var isExpired: Bool {
        expiresAt.map { $0 <= .now } ?? false
    }
}

struct AppClipWorkspaceComputer: Codable, Identifiable, Sendable, Equatable {
    let deviceId: String
    let label: String
    let capabilities: [String]
    let online: Bool

    var id: String { deviceId }
    var supportsCursorInsertion: Bool { capabilities.contains("cursor-insertion") }
}

struct AppClipGuestCloudClient: Sendable {
    private enum Endpoint: String {
        case putBatch = "api/app-clip/outbox/sync"
        case listComputers = "api/app-clip/computers/list"
        case queueCursorDelivery = "api/app-clip/deliveries/queue"
        case createPhotoUploadURL = "api/app-clip/photos/upload-url"
        case finalizeBatch = "api/app-clip/batches/finalize"
    }

    private let urlSession: URLSession

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    func mirrorCapture(
        session: AppClipGuestCloudSession,
        kind: String,
        value: String,
        format: String,
        capturedAt: Date,
        resultId: String? = nil,
        targetDeviceId: String? = nil
    ) async throws {
        try requireActive(session)
        let batchId = "appclip-batch-\(UUID().uuidString.lowercased())"
        let resolvedResultId = resultId ?? "appclip-result-\(UUID().uuidString.lowercased())"
        let result = GuestCloudResult(
            resultId: resolvedResultId,
            kind: kind,
            text: value,
            format: format,
            contentType: nil,
            byteCount: 0,
            checksum: nil,
            clientCreatedAt: capturedAt.millisecondsSince1970
        )
        let _: GuestCloudBatchResponse = try await post(
            GuestCloudBatchRequest(
                guestCloudGrant: session.grant,
                batchId: batchId,
                clientCreatedAt: capturedAt.millisecondsSince1970,
                results: [result]
            ),
            to: .putBatch,
            baseURL: session.baseURL
        )
        let _: EmptyGuestCloudResponse = try await post(
            GuestCloudFinalizeRequest(guestCloudGrant: session.grant, batchId: batchId),
            to: .finalizeBatch,
            baseURL: session.baseURL
        )
        if let targetDeviceId, (kind == "text" || kind == "barcode") {
            let _: GuestCloudCursorDeliveryResponse = try await post(
                GuestCloudCursorDeliveryRequest(
                    guestCloudGrant: session.grant,
                    deliveryId: "appclip-delivery-\(UUID().uuidString.lowercased())",
                    resultId: resolvedResultId,
                    targetDeviceId: targetDeviceId,
                    kind: kind,
                    text: value,
                    format: format,
                    clientCreatedAt: capturedAt.millisecondsSince1970
                ),
                to: .queueCursorDelivery,
                baseURL: session.baseURL
            )
        }
    }

    func listComputers(session: AppClipGuestCloudSession) async throws -> [AppClipWorkspaceComputer] {
        try requireActive(session)
        let response: GuestCloudComputerListResponse = try await post(
            GuestCloudGrantRequest(guestCloudGrant: session.grant),
            to: .listComputers,
            baseURL: session.baseURL
        )
        return response.computers
    }

    func mirrorPhoto(
        session: AppClipGuestCloudSession,
        data: Data,
        filename: String,
        capturedAt: Date
    ) async throws {
        try requireActive(session)
        let batchId = "appclip-batch-\(UUID().uuidString.lowercased())"
        let resultId = "appclip-photo-\(UUID().uuidString.lowercased())"
        let result = GuestCloudResult(
            resultId: resultId,
            kind: "photo",
            text: nil,
            format: filename,
            contentType: "image/jpeg",
            byteCount: data.count,
            checksum: nil,
            clientCreatedAt: capturedAt.millisecondsSince1970
        )
        let _: GuestCloudBatchResponse = try await post(
            GuestCloudBatchRequest(
                guestCloudGrant: session.grant,
                batchId: batchId,
                clientCreatedAt: capturedAt.millisecondsSince1970,
                results: [result]
            ),
            to: .putBatch,
            baseURL: session.baseURL
        )
        let upload: GuestCloudPhotoUpload = try await post(
            GuestCloudPhotoUploadRequest(
                guestCloudGrant: session.grant,
                batchId: batchId,
                resultId: resultId
            ),
            to: .createPhotoUploadURL,
            baseURL: session.baseURL
        )
        var request = URLRequest(url: upload.url)
        request.httpMethod = "PUT"
        upload.headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
        let (_, response) = try await urlSession.upload(for: request, from: data)
        try validate(response)
        let _: EmptyGuestCloudResponse = try await post(
            GuestCloudFinalizeRequest(guestCloudGrant: session.grant, batchId: batchId),
            to: .finalizeBatch,
            baseURL: session.baseURL
        )
    }

    private func post<Request: Encodable & Sendable, Response: Decodable & Sendable>(
        _ body: Request,
        to endpoint: Endpoint,
        baseURL: URL
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: endpoint.rawValue))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await urlSession.data(for: request)
        try validate(response)
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw AppClipGuestCloudError.invalidResponse
        }
    }

    private func requireActive(_ session: AppClipGuestCloudSession) throws {
        if session.isExpired { throw AppClipGuestCloudError.expired }
    }

    private func validate(_ response: URLResponse) throws {
        guard let response = response as? HTTPURLResponse else {
            throw AppClipGuestCloudError.invalidResponse
        }
        if response.statusCode == 401 || response.statusCode == 403 {
            throw AppClipGuestCloudError.expired
        }
        guard (200..<300).contains(response.statusCode) else {
            throw AppClipGuestCloudError.httpStatus(response.statusCode)
        }
    }
}

private struct GuestCloudBatchRequest: Codable, Sendable {
    let guestCloudGrant: String
    let batchId: String
    let clientCreatedAt: Double
    let results: [GuestCloudResult]
}

private struct GuestCloudGrantRequest: Codable, Sendable {
    let guestCloudGrant: String
}

private struct GuestCloudComputerListResponse: Codable, Sendable {
    let computers: [AppClipWorkspaceComputer]
}

private struct GuestCloudCursorDeliveryRequest: Codable, Sendable {
    let guestCloudGrant: String
    let deliveryId: String
    let resultId: String
    let targetDeviceId: String
    let kind: String
    let text: String
    let format: String
    let clientCreatedAt: Double
}

private struct GuestCloudCursorDeliveryResponse: Codable, Sendable {
    let deliveryId: String
    let idempotent: Bool
    let state: String
}

private struct GuestCloudResult: Codable, Sendable {
    let resultId: String
    let kind: String
    let text: String?
    let format: String?
    let contentType: String?
    let byteCount: Int
    let checksum: String?
    let clientCreatedAt: Double
}

private struct GuestCloudBatchResponse: Codable, Sendable {
    let batchId: String
    let idempotent: Bool
    let status: String
}

private struct GuestCloudPhotoUploadRequest: Codable, Sendable {
    let guestCloudGrant: String
    let batchId: String
    let resultId: String
}

private struct GuestCloudPhotoUpload: Codable, Sendable {
    let url: URL
    let headers: [String: String]
}

private struct GuestCloudFinalizeRequest: Codable, Sendable {
    let guestCloudGrant: String
    let batchId: String
}

private struct EmptyGuestCloudResponse: Codable, Sendable {}

private enum AppClipGuestCloudError: Error {
    case expired
    case httpStatus(Int)
    case invalidResponse
}

private extension Date {
    var millisecondsSince1970: Double { timeIntervalSince1970 * 1_000 }
}
