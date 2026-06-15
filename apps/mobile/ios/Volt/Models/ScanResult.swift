import Foundation

struct ScanResult: Identifiable, Equatable {
    enum Kind: String {
        case barcode
        case text
        case photo
        case dictation
    }

    let id = UUID()
    let kind: Kind
    let value: String
    let format: String
    let capturedAt: Date

    init(kind: Kind, value: String, format: String, capturedAt: Date = .now) {
        self.kind = kind
        self.value = value
        self.format = format
        self.capturedAt = capturedAt
    }
}
