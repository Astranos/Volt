import Foundation

struct ScanResult: Identifiable, Equatable {
    enum Kind: String {
        case barcode
        case text
        case photo
        case dictation
    }

    enum Source: String {
        case capture
        case dictation
        case upload
    }

    enum DeliveryState: String {
        case saved
        case sending
        case sent
        case failed

        var label: String {
            switch self {
            case .saved: "Saved on device"
            case .sending: "Sending to Chrome"
            case .sent: "Sent to Chrome"
            case .failed: "Send failed"
            }
        }
    }

    let id: UUID
    let kind: Kind
    let source: Source
    let value: String
    let format: String
    let capturedAt: Date
    var deliveryState: DeliveryState
    var imageData: Data?
    var batchId: String?

    init(
        id: UUID = UUID(),
        kind: Kind,
        source: Source = .capture,
        value: String,
        format: String,
        capturedAt: Date = .now,
        deliveryState: DeliveryState = .saved,
        imageData: Data? = nil,
        batchId: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.source = source
        self.value = value
        self.format = format
        self.capturedAt = capturedAt
        self.deliveryState = deliveryState
        self.imageData = imageData
        self.batchId = batchId
    }
}
