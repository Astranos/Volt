import Observation
import StoreKit
import UIKit

/// Whether this install came from TestFlight. App Store builds report `.production`; TestFlight
/// reports `.sandbox`. Debug builds always count so the flow can be exercised in the simulator.
enum AppDistributionChannel {
    static func isTestFlightOrDebug() async -> Bool {
        // Screenshot runs can render the App Store variant of the UI.
        if ScreenshotScenario.isEnabled,
           ProcessInfo.processInfo.environment["VOLT_SCREENSHOT_APP_STORE"] == "1" {
            return false
        }
        #if DEBUG
        return true
        #else
        guard let result = try? await AppTransaction.shared else { return false }
        switch result {
        case .verified(let transaction), .unverified(let transaction, _):
            return transaction.environment == .sandbox
        }
        #endif
    }
}

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
    var activeMode: CaptureMode = .ocr
    var selectedSection: AppSection = .text
    var results: [ScanResult] = []
    var statusText = "Ready to capture"
    var targetHint = "Captures save on this iPhone and sync to your Volt workspace when signed in."
    var ocrReviewImage: UIImage?
    var ocrReviewText = ""
    var ocrTextRegions: [RecognizedTextRegion] = []
    /// The cropped capture before OCR cleanup, kept so TestFlight testers can flag bad parses.
    var ocrSourceImage: UIImage?
    /// Every region the recognizer returned, before review filtering, for flagged captures.
    var ocrRecognizedRegions: [RecognizedTextRegion] = []
    var ocrFlagState: OcrFlagState = .idle
    /// Only TestFlight (and local debug) builds can flag OCR captures for parser work.
    var isOcrFlaggingAvailable = false
    var isRecognizingText = false
    var captureDeliveryToast: CaptureDeliveryToast?
    var photoUploadProgress: PhotoUploadProgress?
    /// Bumped on every successful shutter capture so the viewfinder can flash and tap.
    var photoCaptureCount = 0
    var barcodeRecognitionMode: BarcodeRecognitionMode = .upc {
        didSet {
            UserDefaults.standard.set(barcodeRecognitionMode.rawValue, forKey: Self.barcodeRecognitionModeStorageKey)
            camera.updateBarcodeRecognitionMode(barcodeRecognitionMode)
        }
    }

    let camera = CameraModel()
    let cloudWorkspace: CloudWorkspaceStore
    let speechDictation = SpeechDictationService()

    var dictationDraftStatus = "Tap Start Dictation to begin."
    var dictationPublishError: String?
    var dictationSessionId: UUID?
    /// Fires once per finished dictation so the view can play the matching haptic.
    var dictationOutcome: DictationOutcomeSignal?
    @ObservationIgnored var dictationDraftTask: Task<Void, Never>?
    @ObservationIgnored private var dictationOutcomeTick = 0

    func noteDictationOutcome(_ kind: DictationOutcomeSignal.Kind) {
        dictationOutcomeTick += 1
        dictationOutcome = DictationOutcomeSignal(kind: kind, tick: dictationOutcomeTick)
    }

    var lastBarcodeValue: String?
    var lastBarcodeSentAt: Date?
    /// The presented camera's unified session identity. It is also the transport
    /// batch ID for now, so every mode captured in one presentation groups together.
    var activeCaptureBatchId: String?
    var capturePhotoBatch: (id: String, expiresAt: Date)?
    var resumedPhotoBatchId: String?
    @ObservationIgnored let captureFailureFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored let captureFailureImpactFeedback = UIImpactFeedbackGenerator(style: .heavy)

    init(cloudWorkspace: CloudWorkspaceStore = CloudWorkspaceStore()) {
        self.cloudWorkspace = cloudWorkspace
        _ = cloudWorkspace.pruneExpiredHistory()
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

    @discardableResult
    func beginCaptureSession() -> String {
        let id = "batch-\(UUID().uuidString.lowercased())"
        activeCaptureBatchId = id
        restoreScreenshotOcrReviewIfNeeded()
        return id
    }

    func endCaptureSession(id: String? = nil) {
        if let id, activeCaptureBatchId != id { return }
        activeCaptureBatchId = nil
        resumedPhotoBatchId = nil
    }

    @discardableResult
    func resumeCaptureSession(batchId: String) -> String {
        activeCaptureBatchId = batchId
        resumedPhotoBatchId = batchId
        return batchId
    }

    func currentCaptureBatchId() -> String {
        activeCaptureBatchId ?? beginCaptureSession()
    }

    /// The app can stay alive for days, so this also runs each time it returns to the foreground.
    func pruneExpiredHistory() {
        let expired = cloudWorkspace.pruneExpiredHistory()
        guard !expired.isEmpty else { return }
        results.removeAll { expired.contains($0.id) }
    }

    var activeSessionCaptureCount: Int {
        guard let activeCaptureBatchId else { return 0 }
        return results.count { $0.batchId == activeCaptureBatchId }
    }
}
