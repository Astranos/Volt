import UIKit

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
        case .sessions, .captureTextPre, .captureReview, .captureReviewSend, .captureBarcode, .capturePhoto, .captureResults:
            .scan
        case .dictation:
            .dictation
        case .upload:
            .upload
        }
    }
}

@MainActor
extension ScannerStore {
    func applyScreenshotFixturesIfNeeded() {
        guard let scenario = ScreenshotScenario.current else { return }

        let sessions = Self.screenshotPairedSessions
        pairedSessions = sessions
        peerTarget = Self.screenshotPeerTarget(for: scenario)
        pairingSession = PairingSession(
            token: "mock-token",
            sessionId: peerTarget?.chromeSessionId,
            attemptId: nil,
            offer: nil,
            answerURL: nil,
            label: nil,
            sourceURL: URL(string: "volt://screenshots/mock-session")!
        )
        connectionStatus = .connected
        statusText = "Connected to Chrome"
        targetHint = peerTarget?.displayText ?? "Ready to send captures."
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
            dictation.transcript = Self.dictationTranscript
            dictation.isRecording = true
        case .upload:
            results = Self.uploadResults
        }
    }

    static var screenshotPairedSessions: [PairedScannerSession] {
        [
            ("left-buyer", "browser-left-buyer", "Left Buyer", -300),
            ("right-buyer", "browser-right-buyer", "Right Buyer", -900),
            ("left-lister", "browser-left-lister", "Left Lister", -1_800),
            ("right-lister", "browser-right-lister", "Right Lister", -2_700),
            ("shipping", "browser-shipping", "Shipping", -3_600),
        ].map { id, browserSessionId, displayName, offset in
            PairedScannerSession(
                id: id,
                browserSessionId: browserSessionId,
                displayName: displayName,
                pairedAt: Date(timeIntervalSince1970: 1_780_000_000 + TimeInterval(offset)),
                lastConnectedAt: Date.now.addingTimeInterval(TimeInterval(offset))
            )
        }
    }

    static func screenshotPeerTarget(for scenario: ScreenshotScenario) -> ScannerPeerTarget {
        let session: PairedScannerSession
        switch scenario {
        case .sessions, .captureTextPre, .captureReview, .captureReviewSend, .captureBarcode, .capturePhoto, .captureResults:
            session = screenshotPairedSessions[2]
        case .dictation:
            session = screenshotPairedSessions[0]
        case .upload:
            session = screenshotPairedSessions[4]
        }

        return ScannerPeerTarget(
            chromeSessionId: session.browserSessionId,
            sessionLabel: session.displayName,
            tabTitle: scenario.tabTitle,
            tabURL: scenario.tabURL,
            cursorLabel: scenario.cursorLabel,
            browser: "Chrome"
        )
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
                deliveryState: .sending
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
    var tabTitle: String {
        switch self {
        case .sessions:
            "Volt Command Center"
        case .captureTextPre, .captureReview, .captureReviewSend, .captureBarcode, .capturePhoto, .captureResults:
            "Inventory Draft - Console"
        case .dictation:
            "eBay Listing Description"
        case .upload:
            "Shipping Batch Upload"
        }
    }

    var tabURL: String {
        switch self {
        case .sessions:
            "chrome://extensions"
        case .captureTextPre, .captureReview, .captureReviewSend, .captureBarcode, .capturePhoto, .captureResults:
            "https://seller.example.local/inventory/ps5"
        case .dictation:
            "https://www.ebay.com/sl/list"
        case .upload:
            "https://shipping.example.local/batches"
        }
    }

    var cursorLabel: String {
        switch self {
        case .sessions:
            "Scanner command menu"
        case .captureTextPre, .captureReview, .captureReviewSend, .captureBarcode, .capturePhoto, .captureResults:
            "SKU and serial number field"
        case .dictation:
            "Description field"
        case .upload:
            "Upload drop zone"
        }
    }

    var initialCaptureMode: CaptureMode {
        switch self {
        case .captureBarcode:
            .barcode
        case .capturePhoto:
            .photo
        case .dictation:
            .dictation
        case .sessions, .captureTextPre, .captureReview, .captureReviewSend, .captureResults, .upload:
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
