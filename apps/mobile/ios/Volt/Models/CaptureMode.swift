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
