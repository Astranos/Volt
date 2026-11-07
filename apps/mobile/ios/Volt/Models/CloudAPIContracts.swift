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

/// One recognizer region as it was shown in OCR review. Boxes use Vision's normalized,
/// bottom-left-origin coordinates so a flagged capture can be replayed against its photo.
struct OcrFlagRegionPayload: Codable, Sendable {
    let text: String
    let confidence: Double
    let isDeviceIdentifier: Bool
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct CreateOcrFlagRequest: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let flagId: String
    let byteCount: Int
    let selectedRawText: String
    let selectedCleanedText: String?
    let regions: [OcrFlagRegionPayload]
    let rawRegionTexts: [String]
    let appVersion: String?
    let appBuild: String?
    /// What the user typed over the OCR value before flagging: the expected answer for this capture.
    let note: String?
}

struct CreateOcrFlagResponse: Codable, Sendable {
    let flagId: String
    let upload: PresignedPhotoUpload
}

struct FinalizeOcrFlagRequest: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let flagId: String
}

/// The OCR review state a TestFlight tester flags: the captured photo plus what the recognizer read.
struct OcrFlagCapture: Sendable {
    let photoJPEG: Data
    let selectedRawText: String
    let selectedCleanedText: String?
    let regions: [OcrFlagRegionPayload]
    let rawRegionTexts: [String]
    let correctedText: String?
}

struct MarkCloudBatchReadyRequest: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let batchId: String
}

struct ListCloudComputersRequest: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
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
