import Foundation

enum CaptureMode: String, CaseIterable, Identifiable, Codable {
    case ocr
    case barcode
    case photo
    case dictation

    var id: String { rawValue }

    var title: String {
        switch self {
        case .ocr: "Text"
        case .barcode: "Barcode"
        case .photo: "Photo"
        case .dictation: "Dictate"
        }
    }

    var symbolName: String {
        switch self {
        case .ocr: "doc.text.viewfinder"
        case .barcode: "barcode.viewfinder"
        case .photo: "camera.viewfinder"
        case .dictation: "mic"
        }
    }
}

enum ProductScanMode: String, CaseIterable, Identifiable, Codable, Sendable {
    case upc
    case name

    var id: String { rawValue }

    var title: String {
        switch self {
        case .upc: "UPC"
        case .name: "Name"
        }
    }

    var systemImage: String {
        switch self {
        case .upc: "barcode"
        case .name: "textformat.characters"
        }
    }
}

struct ProductScanOutput: Equatable, Sendable {
    let mode: ProductScanMode
    let value: String
}
