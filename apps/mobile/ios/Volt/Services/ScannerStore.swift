import Observation
import UIKit

struct CaptureDeliveryToast: Identifiable, Equatable {
    enum Tone: Equatable {
        case success
        case failure
    }

    let id = UUID()
    let title: String
    let message: String
    let systemImage: String
    let tone: Tone
}

@MainActor
@Observable
final class ScannerStore {
    static let barcodeRecognitionModeStorageKey = "volt.barcodeRecognitionMode.v1"

    let ocrCaptureMaxDimension: CGFloat = 1800
    let photoLongEdge: CGFloat = 2200

    var activeMode: CaptureMode = .ocr
    var selectedSection: AppSection = .text
    var results: [ScanResult] = []
    var statusText = "Ready to capture"
    var targetHint = "Captures save on this iPhone and sync to your Volt workspace when signed in."
    var ocrReviewImage: UIImage?
    var ocrReviewText = ""
    var ocrTextRegions: [RecognizedTextRegion] = []
    var isRecognizingText = false
    var captureDeliveryToast: CaptureDeliveryToast?
    var photoUploadProgress: PhotoUploadProgress?
    var barcodeRecognitionMode: BarcodeRecognitionMode = .upc {
        didSet {
            UserDefaults.standard.set(barcodeRecognitionMode.rawValue, forKey: Self.barcodeRecognitionModeStorageKey)
            camera.updateBarcodeRecognitionMode(barcodeRecognitionMode)
        }
    }

    let camera = CameraModel()
    let cloudWorkspace: CloudWorkspaceStore

    var lastBarcodeValue: String?
    var lastBarcodeSentAt: Date?
    var photoBatch: (id: String, expiresAt: Date)?
    var resumedPhotoBatchId: String?
    @ObservationIgnored let captureFailureFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored let captureFailureImpactFeedback = UIImpactFeedbackGenerator(style: .heavy)

    init(cloudWorkspace: CloudWorkspaceStore = CloudWorkspaceStore()) {
        self.cloudWorkspace = cloudWorkspace
        self.results = cloudWorkspace.restoredResults
        barcodeRecognitionMode = Self.savedBarcodeRecognitionMode()
        camera.updateBarcodeRecognitionMode(barcodeRecognitionMode)
        applyScreenshotFixturesIfNeeded()
        cloudWorkspace.setDeliveryResolutionHandler { [weak self] resolution in
            self?.applyDeliveryResolution(resolution)
        }
    }

    private static func savedBarcodeRecognitionMode() -> BarcodeRecognitionMode {
        guard let rawValue = UserDefaults.standard.string(forKey: barcodeRecognitionModeStorageKey),
              let mode = BarcodeRecognitionMode(rawValue: rawValue)
        else { return .upc }
        return mode
    }

    func playCaptureFailureFeedback() {
        captureFailureImpactFeedback.impactOccurred(intensity: 1)
        captureFailureFeedback.notificationOccurred(.error)
    }
}
