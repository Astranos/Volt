import Foundation

struct DeviceEnrollmentRequest: Codable, Sendable {
    let enrollmentCode: String
    let label: String?
}

struct DeviceEnrollmentResponse: Codable, Sendable {
    let deviceId: String
    let deviceSecret: String
    let workspaceId: String
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
