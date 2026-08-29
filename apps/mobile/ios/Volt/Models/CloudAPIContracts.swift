import Foundation

struct BootstrapMobileDeviceRequest: Codable, Sendable {
    let installationId: String
    let label: String
    let existingDeviceId: String?
}

struct BootstrapMobileDeviceResponse: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let workspaceId: String
    let clerkUserId: String
}

struct PutCloudBatchRequest: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let batchId: String
    let clientCreatedAt: Double
    let results: [CloudResultInput]
}

struct CloudResultInput: Codable, Sendable {
    let resultId: String
    let kind: String
    let text: String?
    let format: String?
    let contentType: String?
    let byteCount: Int
    let checksum: String?
    let clientCreatedAt: Double
}

struct PutCloudBatchResponse: Codable, Sendable {
    let batchId: String
    let idempotent: Bool
    let status: String
}

struct CreatePhotoUploadURLRequest: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let batchId: String
    let resultId: String
    let contentType: String
    let byteCount: Int
}

struct PresignedPhotoUpload: Codable, Sendable {
    let url: URL
    let headers: [String: String]
}

struct MarkCloudBatchReadyRequest: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let batchId: String
}

struct CloudComputer: Codable, Equatable, Identifiable, Sendable {
    let deviceId: String
    let label: String
    let capabilities: [String]
    let online: Bool

    var id: String { deviceId }
    var supportsCursorInsertion: Bool { capabilities.contains("cursor-insertion") }
}

struct ListCloudComputersRequest: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
}

struct ListCloudComputersResponse: Codable, Sendable {
    let cursorTargetDeviceId: String?
    let computers: [CloudComputer]
}

struct SetCursorTargetRequest: Encodable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let cursorTargetDeviceId: String?

    private enum CodingKeys: String, CodingKey {
        case deviceId
        case deviceSecret
        case cursorTargetDeviceId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceId, forKey: .deviceId)
        try container.encode(deviceSecret, forKey: .deviceSecret)
        if let cursorTargetDeviceId {
            try container.encode(cursorTargetDeviceId, forKey: .cursorTargetDeviceId)
        } else {
            try container.encodeNil(forKey: .cursorTargetDeviceId)
        }
    }
}

struct SetCursorTargetResponse: Codable, Sendable {
    let cursorTargetDeviceId: String?
}

struct QueueCursorDeliveryRequest: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let deliveryId: String
    let resultId: String
    let targetDeviceId: String
    let kind: String
    let text: String
    let format: String?
    let clientCreatedAt: Double
}

struct QueueCursorDeliveryResponse: Codable, Sendable {
    let deliveryId: String
    let idempotent: Bool
    let state: String
}

struct CursorDeliveryStatusRequest: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let deliveryIds: [String]
}

struct CursorDeliveryStatus: Codable, Sendable {
    let deliveryId: String
    let state: String
    let errorCode: String?
    let deliveredAt: Double?

    var isTerminal: Bool { state == "delivered" || state == "failed" }
}

struct CursorDeliveryStatusResponse: Codable, Sendable {
    let statuses: [CursorDeliveryStatus]
}

struct ProductScanResponse: Decodable, Sendable {
    let mode: ProductScanMode?
    let value: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        mode = try container.decodeIfPresent(ProductScanMode.self, forKey: .mode)
        value = try container.decodeIfPresent(String.self, forKey: .value)
    }

    private enum CodingKeys: String, CodingKey {
        case mode
        case value
    }
}
