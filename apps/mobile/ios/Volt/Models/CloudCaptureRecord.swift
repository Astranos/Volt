import Foundation

struct CloudCaptureRecord: Codable, Equatable, Identifiable, Sendable {
    enum State: String, Codable, Sendable {
        case pending
        case syncing
        case uploaded
        case failed
    }

    let id: UUID
    let kind: String
    let source: String
    let value: String
    let format: String
    let capturedAt: Date
    let batchId: String
    let photoFilename: String?
    let photoContentType: String?
    var state: State
    var attemptCount: Int
    var nextAttemptAt: Date?

    var idempotencyKey: String { id.uuidString.lowercased() }
}
