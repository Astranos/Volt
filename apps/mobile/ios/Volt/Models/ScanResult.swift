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
            case .sending: "Insertion pending"
            case .sent: "Synced"
            case .failed: "Insertion failed"
            }
        }
    }

    let id: UUID
    let kind: Kind
    let source: Source
    let value: String
    let format: String
    let capturedAt: Date
    /// User-facing session identity. This intentionally reuses the cloud batch ID
    /// until the server grows a separate session field.
    var batchId: String?
    var deliveryState: DeliveryState
    /// Photo bytes captured in this run of the app.
    var imageData: Data?
    /// Photo restored from disk at launch; read on demand so history never holds every photo in memory.
    var photoURL: URL?

    var hasPhoto: Bool { imageData != nil || photoURL != nil }

    func loadPhotoData() -> Data? {
        imageData ?? photoURL.flatMap { try? Data(contentsOf: $0) }
    }

    init(
        id: UUID = UUID(),
        kind: Kind,
        source: Source = .capture,
        value: String,
        format: String,
        capturedAt: Date = .now,
        deliveryState: DeliveryState = .saved,
        imageData: Data? = nil,
        photoURL: URL? = nil,
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
        self.photoURL = photoURL
        self.batchId = batchId
    }
}
