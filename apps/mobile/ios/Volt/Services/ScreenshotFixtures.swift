import UIKit
import SwiftUI

enum ScreenshotScenario: String {
    case sessions
    case captureTextPre
    case captureReview
    case captureReviewSend
    case captureBarcode
    case capturePhoto
    case captureResults
    case dictation
    case upload

    static var isEnabled: Bool {
        ProcessInfo.processInfo.environment["VOLT_SCREENSHOTS"] == "1"
    }

    static var current: ScreenshotScenario? {
        guard isEnabled,
              let rawValue = ProcessInfo.processInfo.environment["VOLT_SCREENSHOT_SCENARIO"]
        else { return nil }
        return ScreenshotScenario(rawValue: rawValue)
    }

    var initialSection: AppSection {
        switch self {
        case .captureTextPre, .captureReview, .captureReviewSend:
            .text
        case .captureBarcode:
            .barcode
        case .capturePhoto, .sessions, .captureResults:
            .photos
        case .upload:
            .photos
        case .dictation:
            .dictation
        }
    }
}

struct SubscriptionReviewScreenshotView: View {
    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    LabeledContent("Signed in as", value: "appreview@volt.app")
                    LabeledContent("Workspace", value: "Personal")
                }

                Section("Volt Pro") {
                    Label("Sync scanner results and private photos across Volt on iPhone and Chrome.", systemImage: "icloud.fill")
                        .foregroundStyle(.secondary)

                    Button(action: {}) {
                        Label("Start 1 Week Free Trial", systemImage: "bolt.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)

                    Button("Restore Purchases", systemImage: "arrow.clockwise", action: {})
                        .frame(maxWidth: .infinity, minHeight: 44)

                    Text("1 week free, then $9.00 per month. The subscription renews automatically unless canceled at least 24 hours before the current period ends. Manage or cancel in App Store account settings.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 16) {
                        Link("Privacy Policy", destination: AppConfiguration.privacyPolicyURL)
                        Link("Terms of Use", destination: AppConfiguration.termsOfUseURL)
                    }
                    .font(.footnote.weight(.semibold))
                }
            }
            .navigationTitle("Volt Access")
        }
        .tint(.green)
    }
}

@MainActor
extension ScannerStore {
    func applyScreenshotFixturesIfNeeded() {
        guard let scenario = ScreenshotScenario.current else { return }

        statusText = "Ready to capture"
        targetHint = "Captures save on this iPhone and sync to your Volt workspace when signed in."
        selectedSection = scenario.initialSection
        activeMode = scenario.initialCaptureMode

        switch scenario {
        case .sessions:
            results = []
        case .captureTextPre:
            results = Self.captureResults
            camera.liveTextCandidates = Self.liveIdentifierCandidates
        case .captureReview, .captureReviewSend:
            results = Self.captureResults
            ocrReviewImage = Self.ocrReviewImage()
            ocrReviewText = Self.ocrReviewText
            ocrTextRegions = Self.ocrRegions
        case .captureBarcode, .capturePhoto:
            results = Self.captureResults
        case .captureResults:
            results = Self.captureResults
        case .dictation:
            results = Self.dictationResults
        case .upload:
            results = Self.uploadResults
        }
    }

    static let ocrReviewText = """
    FH7XC36BKDT0
    """

    static let ocrRegions: [RecognizedTextRegion] = [
        region(
            "FH7XC36BKDT0",
            x: 0.532,
            y: 0.674,
            width: 0.151,
            height: 0.021,
            confidence: 0.91,
            isDeviceIdentifier: true
        ),
    ]

    static let liveIdentifierCandidates: [LiveTextCandidate] = [
        LiveTextCandidate(
            kind: .serial,
            value: "FH7XC36BKDT0",
            bounds: .zero,
            confidence: 0.93
        ),
    ]

    static let dictationTranscript = "Sony PlayStation 5 Slim Disc, model CFI-2015, one terabyte. Includes controller, HDMI cable, and power cable. Good pre-owned cosmetic condition with light scuffs on the white side panels. Tested and fully functional."

    static var captureResults: [ScanResult] {
        [
            ScanResult(
                kind: .barcode,
                value: "711719573364",
                format: "UPC-A",
                capturedAt: Date.now.addingTimeInterval(-80),
                deliveryState: .sent
            ),
            ScanResult(
                kind: .text,
                value: "Sony PlayStation 5 Slim Disc PS5\nMODEL CFI-2015\n1TB White Console",
                format: "OCR text",
                capturedAt: Date.now.addingTimeInterval(-140),
                deliveryState: .sent
            ),
            ScanResult(
                kind: .text,
                value: "SKU: MI01-8077A-R1R3\nSerial: E43801VKK12677215\nIncludes: HDMI cable, power cable, controller",
                format: "OCR text",
                capturedAt: Date.now.addingTimeInterval(-220),
                deliveryState: .saved
            ),
            ScanResult(
                kind: .photo,
                value: "Actual PS5 console photo",
                format: "photo",
                capturedAt: Date.now.addingTimeInterval(-310),
                deliveryState: .sent,
                imageData: assetPhotoData(named: "screenshot-product-1")
            ),
        ]
    }

    static var dictationResults: [ScanResult] {
        [
            ScanResult(
                kind: .dictation,
                source: .dictation,
                value: dictationTranscript,
                format: "dictation",
                capturedAt: Date.now.addingTimeInterval(-40),
                deliveryState: .saved
            )
        ]
    }

    static var uploadResults: [ScanResult] {
        let shippingBatch = "batch-shipping-photos"
        let listingBatch = "batch-listing-photos"
        return [
            ScanResult(kind: .photo, source: .upload, value: "Console front", format: "photo", capturedAt: Date.now.addingTimeInterval(-90), deliveryState: .sent, imageData: assetPhotoData(named: "screenshot-product-1"), batchId: listingBatch),
            ScanResult(kind: .photo, source: .upload, value: "Console angle", format: "photo", capturedAt: Date.now.addingTimeInterval(-82), deliveryState: .sent, imageData: assetPhotoData(named: "screenshot-product-2"), batchId: listingBatch),
            ScanResult(kind: .photo, source: .upload, value: "Disc drive side", format: "photo", capturedAt: Date.now.addingTimeInterval(-74), deliveryState: .sent, imageData: assetPhotoData(named: "screenshot-product-3"), batchId: listingBatch),
            ScanResult(kind: .photo, source: .upload, value: "Ports and rear", format: "photo", capturedAt: Date.now.addingTimeInterval(-66), deliveryState: .sent, imageData: assetPhotoData(named: "screenshot-product-4"), batchId: listingBatch),
            ScanResult(kind: .photo, source: .upload, value: "Controller and cables", format: "photo", capturedAt: Date.now.addingTimeInterval(-58), deliveryState: .sent, imageData: assetPhotoData(named: "screenshot-product-5"), batchId: listingBatch),
            ScanResult(kind: .photo, source: .upload, value: "Accessory close-up", format: "photo", capturedAt: Date.now.addingTimeInterval(-1_800), deliveryState: .sending, imageData: assetPhotoData(named: "screenshot-product-6"), batchId: shippingBatch),
            ScanResult(kind: .photo, source: .upload, value: "Console condition close-up", format: "photo", capturedAt: Date.now.addingTimeInterval(-1_790), deliveryState: .sending, imageData: assetPhotoData(named: "screenshot-product-7"), batchId: shippingBatch),
        ]
    }

    private static func region(
        _ text: String,
        x: CGFloat,
        y: CGFloat,
        width: CGFloat,
        height: CGFloat,
        confidence: Float,
        isDeviceIdentifier: Bool = false
    ) -> RecognizedTextRegion {
        let rect = CGRect(x: x, y: y, width: width, height: height)
        return RecognizedTextRegion(
            text: text,
            boundingBox: rect,
            quadrilateral: TextQuadrilateral(rect: rect),
            confidence: confidence,
            isDeviceIdentifier: isDeviceIdentifier
        )
    }

    private static func ocrReviewImage() -> UIImage {
        UIImage(named: "screenshot-watch-ocr") ?? fallbackPhoto(title: "Apple Watch OCR", accent: .systemGray)
    }

    static func screenshotCaptureImage(for scenario: ScreenshotScenario) -> UIImage? {
        switch scenario {
        case .captureBarcode:
            UIImage(named: "screenshot-barcode-game")
        case .capturePhoto:
            UIImage(named: "screenshot-product-1")
        case .captureTextPre:
            UIImage(named: "screenshot-watch-ocr")
        case .sessions, .captureReview, .captureReviewSend, .captureResults, .dictation, .upload:
            nil
        }
    }

    private static func assetPhotoData(named name: String) -> Data? {
        guard let image = UIImage(named: name) else {
            return fallbackPhoto(title: name, accent: .systemGreen).jpegData(compressionQuality: 0.86)
        }
        return image.jpegData(compressionQuality: 0.9)
    }

    private static func fallbackPhoto(title: String, accent: UIColor) -> UIImage {
        let size = CGSize(width: 900, height: 900)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { context in
            UIColor(red: 0.95, green: 0.96, blue: 0.94, alpha: 1).setFill()
            context.fill(CGRect(origin: .zero, size: size))

            accent.withAlphaComponent(0.18).setFill()
            context.fill(CGRect(x: 0, y: 0, width: size.width, height: 260))

            let device = CGRect(x: 190, y: 230, width: 520, height: 360)
            UIBezierPath(roundedRect: device, cornerRadius: 42).addClip()
            UIColor(red: 0.12, green: 0.13, blue: 0.15, alpha: 1).setFill()
            context.fill(device)
            UIColor.white.withAlphaComponent(0.92).setFill()
            context.fill(CGRect(x: 260, y: 285, width: 90, height: 250))
            context.fill(CGRect(x: 550, y: 285, width: 90, height: 250))

            drawText(title, at: CGPoint(x: 70, y: 665), size: 64, weight: .bold, color: .black)
            drawText("Screenshot fixture", at: CGPoint(x: 70, y: 750), size: 34, weight: .regular, color: .darkGray)
        }
    }

    private static func drawText(
        _ text: String,
        at point: CGPoint,
        size: CGFloat,
        weight: UIFont.Weight,
        color: UIColor
    ) {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: size, weight: weight),
            .foregroundColor: color,
        ]
        text.draw(at: point, withAttributes: attributes)
    }
}

extension ScreenshotScenario {
    var initialCaptureMode: CaptureMode {
        switch self {
        case .captureBarcode:
            .barcode
        case .capturePhoto:
            .photo
        case .sessions, .captureTextPre, .captureReview, .captureReviewSend, .captureResults, .dictation, .upload:
            .ocr
        }
    }

    var opensCaptureSession: Bool {
        switch self {
        case .captureTextPre, .captureReview, .captureReviewSend, .captureBarcode, .capturePhoto:
            true
        case .sessions, .captureResults, .dictation, .upload:
            false
        }
    }
}
