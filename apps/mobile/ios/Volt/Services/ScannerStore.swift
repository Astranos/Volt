import Observation
import CoreImage
import CoreImage.CIFilterBuiltins
import Security
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

struct PhotoUploadProgress: Identifiable, Equatable {
    enum Phase: Equatable {
        case preparing
        case uploading
        case finished
    }

    let id: String
    let total: Int
    var prepared: Int
    var completed: Int
    var failed: Int
    var phase: Phase

    var finishedCount: Int {
        completed + failed
    }

    var remainingCount: Int {
        max(0, total - finishedCount)
    }

    var fractionCompleted: Double {
        guard total > 0 else { return 0 }
        return min(1, Double(finishedCount) / Double(total))
    }

    var isActive: Bool {
        phase != .finished
    }

    var title: String {
        switch phase {
        case .preparing:
            "Preparing \(min(prepared + 1, total)) of \(total)"
        case .uploading:
            "Uploading \(min(finishedCount + 1, total)) of \(total)"
        case .finished:
            failed > 0 ? "Uploaded \(completed) of \(total)" : "Uploaded \(total) photo\(total == 1 ? "" : "s")"
        }
    }

    var detail: String {
        if failed > 0 {
            return "\(completed) sent, \(failed) failed, \(remainingCount) left"
        }
        switch phase {
        case .preparing:
            return "\(prepared) ready, \(max(0, total - prepared)) left to prepare"
        case .uploading:
            return "\(completed) sent, \(remainingCount) left"
        case .finished:
            return "All uploads finished"
        }
    }
}

@MainActor
@Observable
final class ScannerStore {
    static let pairedSessionsStorageKey = "volt.pairedScannerSessions.v2"
    static let barcodeRecognitionModeStorageKey = "volt.barcodeRecognitionMode.v1"

    let ocrCaptureMaxDimension: CGFloat = 1800
    let photoLongEdge: CGFloat = 2200
    let dictationRequestLimit: Duration = .seconds(55)
    let dictationReleaseGraceDelay: Duration = .milliseconds(1500)

    var activeMode: CaptureMode = .ocr
    var selectedSection: AppSection = .scan
    var pairingSession: PairingSession?
    var pairedSessions: [PairedScannerSession] = []
    var connectionStatus: ScannerConnectionStatus = .idle
    var peerTarget: ScannerPeerTarget?
    var canCancelReconnect = false
    var results: [ScanResult] = []
    var statusText = "Not paired"
    var targetHint = ScannerStore.disconnectedPairingHint
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
    let dictation = DictationModel()
    let contributorId = ScannerProtocol.makeContributorId()

    static let disconnectedPairingHint = "Use the Pair button next to the section title to connect to Chrome."

    init() {
        loadPairedSessions()
        barcodeRecognitionMode = Self.savedBarcodeRecognitionMode()
        camera.updateBarcodeRecognitionMode(barcodeRecognitionMode)
        dictation.onTranscriptChange = { [weak self] text in
            self?.handleDictationTranscriptChange(text)
        }
        applyScreenshotFixturesIfNeeded()
    }

    private static func savedBarcodeRecognitionMode() -> BarcodeRecognitionMode {
        guard let rawValue = UserDefaults.standard.string(forKey: barcodeRecognitionModeStorageKey),
              let mode = BarcodeRecognitionMode(rawValue: rawValue)
        else { return .upc }
        return mode
    }

    @ObservationIgnored lazy var connection: ScannerWebRTCConnection = {
        let connection = ScannerWebRTCConnection(contributorId: contributorId)
        connection.onStatusChange = { [weak self] status in
            self?.applyConnectionStatus(status)
        }
        connection.onSessionReady = { [weak self] message in
            self?.applySessionReady(message)
        }
        connection.onResultReceived = { [weak self] receipt in
            self?.applyResultReceived(receipt)
        }
        connection.onPhotoTransferCompleted = { [weak self] photoId in
            self?.applyPhotoTransferCompleted(photoId: photoId)
        }
        return connection
    }()
    @ObservationIgnored let signaling = ScannerSignalingClient()
    @ObservationIgnored var photoRetryQueue = MobilePhotoRetryQueue()
    var lastBarcodeValue: String?
    var lastBarcodeSentAt: Date?
    var photoBatch: (id: String, expiresAt: Date)?
    var dictationSessionId: String?
    var lastDictationPartialText = ""
    var dictationStartToken: UUID?
    var shouldStopDictationAfterStart = false
    @ObservationIgnored var dictationLimitTask: Task<Void, Never>?
    var dictationTargetKey: String?
    var lastAutomaticReconnectAt: Date?
    var activeAutomaticReconnectToken: UUID?
    var preservesReconnectCancelOnNextDisconnect = false
    var lastPairingCandidateValue: String?
    @ObservationIgnored var reconnectTask: Task<Void, Never>?
    @ObservationIgnored var dictationGraceStopTask: Task<Void, Never>?
    @ObservationIgnored let pairingImpactFeedback = UIImpactFeedbackGenerator(style: .medium)
    @ObservationIgnored let pairingNotificationFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored let dictationImpactFeedback = UIImpactFeedbackGenerator(style: .light)
    @ObservationIgnored let dictationNotificationFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored let captureSuccessFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored let captureFailureFeedback = UINotificationFeedbackGenerator()
    @ObservationIgnored let captureFailureImpactFeedback = UIImpactFeedbackGenerator(style: .heavy)

    func handleIncomingURL(_ url: URL) {
        let parsed = PairingURLParser.parse(url)
        if let session = parsed.0 {
            pairingSession = session
            Task { await pair(with: session) }
        }
        if let mode = parsed.1 {
            activeMode = mode
        }
    }

    func updateAppIsInBackground(_ isInBackground: Bool) {
        connection.setAppIsInBackground(isInBackground)
    }

    func reconnect(to pairedSession: PairedScannerSession, reportsErrors: Bool = true, isAutomatic: Bool = false) {
        reconnectTask?.cancel()
        let automaticToken = isAutomatic ? UUID() : nil
        activeAutomaticReconnectToken = automaticToken
        canCancelReconnect = true
        peerTarget = ScannerPeerTarget(
            chromeSessionId: pairedSession.browserSessionId,
            sessionLabel: pairedSession.displayName,
            tabTitle: pairedSession.displayName,
            tabURL: nil,
            cursorLabel: nil,
            browser: "Chrome"
        )
        reconnectTask = Task { [weak self] in
            await self?.reconnectWithSavedPairing(
                pairedSession,
                reportsErrors: reportsErrors,
                automaticToken: automaticToken
            )
        }
    }

    func reconnectToMostRecentPairedSessionIfNeeded() {
        switch connectionStatus {
        case .idle, .disconnected:
            break
        case .pairing, .waitingForChrome, .connected, .error:
            return
        }

        let now = Date.now
        if let lastAutomaticReconnectAt,
           now.timeIntervalSince(lastAutomaticReconnectAt) < 15 {
            return
        }

        guard let latestSession = pairedSessions.first else { return }
        lastAutomaticReconnectAt = now
        reconnect(to: latestSession, reportsErrors: false, isAutomatic: true)
    }

    @discardableResult
    func recoverMostRecentPairedSession() -> Bool {
        switch connectionStatus {
        case .idle, .disconnected, .error:
            break
        case .pairing, .waitingForChrome, .connected:
            return true
        }

        let now = Date.now
        if let lastAutomaticReconnectAt,
           now.timeIntervalSince(lastAutomaticReconnectAt) < 15 {
            return false
        }

        guard let latestSession = pairedSessions.first else { return false }
        lastAutomaticReconnectAt = now
        reconnect(to: latestSession, reportsErrors: false, isAutomatic: true)
        return true
    }

    func cancelReconnect() {
        cancelConnectionAttempt()
    }

    func cancelConnectionAttempt() {
        guard canCancelReconnect || reconnectTask != nil || connectionStatus.isConnecting else { return }
        let wasAutomaticReconnect = activeAutomaticReconnectToken != nil
        reconnectTask?.cancel()
        reconnectTask = nil
        activeAutomaticReconnectToken = nil
        canCancelReconnect = false
        preservesReconnectCancelOnNextDisconnect = false
        if wasAutomaticReconnect {
            lastAutomaticReconnectAt = .now
        }
        pairingSession = nil
        connection.close()
        connectionStatus = .disconnected
        statusText = "Connection canceled"
        targetHint = Self.disconnectedPairingHint
    }

    func unpair() {
        connection.close()
        pairingSession = nil
        peerTarget = nil
        dictationSessionId = nil
        applyConnectionStatus(.disconnected)
    }

    func pair(with session: PairingSession) async {
        do {
            let shouldRestoreReconnectCancel = canCancelReconnect
            preservesReconnectCancelOnNextDisconnect = shouldRestoreReconnectCancel
            connection.close()
            if shouldRestoreReconnectCancel {
                canCancelReconnect = true
            }
            try await connection.pair(with: session)
        } catch {
            guard !Task.isCancelled else { return }
            applyConnectionStatus(.error(error.localizedDescription))
        }
    }

    private func reconnectWithSavedPairing(
        _ pairedSession: PairedScannerSession,
        reportsErrors: Bool,
        automaticToken: UUID?
    ) async {
        guard isReconnectCurrent(automaticToken) else { return }
        guard let secret = PairingSecretStore.secret(pairingId: pairedSession.id) else {
            removePairedSession(pairedSession)
            if reportsErrors {
                applyConnectionStatus(.error("Pairing secret missing. Scan the Chrome QR again."))
            } else {
                applyAutomaticReconnectUnavailable(for: pairedSession)
            }
            return
        }

        do {
            guard isReconnectCurrent(automaticToken) else { return }
            applyConnectionStatus(.pairing)
            try await signaling.registerPairing(
                pairingId: pairedSession.id,
                pairingSecret: secret,
                browserSessionId: pairedSession.browserSessionId,
                displayName: pairedSession.displayName,
                phoneDeviceId: contributorId
            )
            guard isReconnectCurrent(automaticToken) else { return }
            let joinWindow = try await signaling.requestReconnect(pairingId: pairedSession.id, pairingSecret: secret)
            guard isReconnectCurrent(automaticToken) else { return }
            let session = PairingSession(
                token: joinWindow.token,
                sessionId: joinWindow.sessionId ?? pairedSession.browserSessionId,
                attemptId: nil,
                offer: nil,
                answerURL: nil,
                label: pairedSession.displayName,
                signalURL: joinWindow.sourceURL.signalBaseURL,
                sourceURL: joinWindow.sourceURL
            )
            pairingSession = session
            await pair(with: session)
            guard isReconnectCurrent(automaticToken) else { return }
        } catch {
            guard isReconnectCurrent(automaticToken) else { return }
            if reportsErrors {
                applyConnectionStatus(.error(error.localizedDescription))
            } else {
                applyAutomaticReconnectUnavailable(for: pairedSession)
            }
        }
    }

    private func isReconnectCurrent(_ automaticToken: UUID?) -> Bool {
        guard !Task.isCancelled else { return false }
        guard let automaticToken else { return true }
        return canCancelReconnect && activeAutomaticReconnectToken == automaticToken
    }

    private func applyAutomaticReconnectUnavailable(for pairedSession: PairedScannerSession) {
        canCancelReconnect = false
        activeAutomaticReconnectToken = nil
        reconnectTask = nil
        connectionStatus = .disconnected
        statusText = "Chrome not reachable"
        targetHint = "Open \(pairedSession.displayName) in Chrome to reconnect, or tap the session button to try again."
    }

    func applyConnectionStatus(_ status: ScannerConnectionStatus, allowsConnectedFeedback: Bool = true) {
        connectionStatus = status
        switch status {
        case .idle:
            canCancelReconnect = false
            activeAutomaticReconnectToken = nil
            preservesReconnectCancelOnNextDisconnect = false
            statusText = "Not paired"
            targetHint = Self.disconnectedPairingHint
        case .pairing:
            statusText = "QR read"
            targetHint = "Creating the secure Chrome connection..."
            pairingImpactFeedback.impactOccurred(intensity: 0.85)
        case .waitingForChrome:
            statusText = "Chrome is responding"
            targetHint = "Waiting for the browser to finish the WebRTC handshake."
            pairingImpactFeedback.impactOccurred(intensity: 0.55)
        case .connected:
            canCancelReconnect = false
            activeAutomaticReconnectToken = nil
            lastAutomaticReconnectAt = nil
            preservesReconnectCancelOnNextDisconnect = false
            statusText = "Connected to Chrome"
            targetHint = peerTarget?.displayText ?? "Ready to send captures."
            if allowsConnectedFeedback {
                pairingNotificationFeedback.notificationOccurred(.success)
            }
        case .disconnected:
            if preservesReconnectCancelOnNextDisconnect {
                preservesReconnectCancelOnNextDisconnect = false
                statusText = "Reconnecting to Chrome"
                targetHint = peerTarget?.displayText ?? "Opening the saved Chrome scanner session."
                return
            }
            canCancelReconnect = false
            activeAutomaticReconnectToken = nil
            preservesReconnectCancelOnNextDisconnect = false
            statusText = "Disconnected"
            targetHint = Self.disconnectedPairingHint
        case .error(let message):
            canCancelReconnect = false
            activeAutomaticReconnectToken = nil
            preservesReconnectCancelOnNextDisconnect = false
            statusText = "Pairing failed"
            targetHint = message
            pairingNotificationFeedback.notificationOccurred(.error)
        }
    }

    func applySessionReady(_ message: ScannerProtocol.SessionReady) {
        if let activeMode = message.activeMode {
            self.activeMode = activeMode
        }
        let wasConnected = connectionStatus.isConnected
        let chromeSessionId = message.peer?.chromeSessionId ?? message.pairing?.browserSessionId ?? pairingSession?.sessionId
        let sessionLabel = firstNonEmpty(
            message.peer?.deviceLabel,
            message.pairing?.displayName,
            peerTarget?.sessionLabel,
            savedSessionLabel(sessionId: chromeSessionId)
        )
        let browserName = message.peer?.platform == "web" ? "Browser" : "Chrome"
        let previousPeerTarget = peerTarget
        let nextPeerTarget = ScannerPeerTarget(
            chromeSessionId: chromeSessionId,
            sessionLabel: sessionLabel,
            tabTitle: message.cursorTarget?.tabTitle,
            tabURL: message.cursorTarget?.url,
            cursorLabel: message.cursorTarget?.label,
            browser: browserName
        )
        let didChangeChromeInputTarget: Bool
        if let previousPeerTarget {
            didChangeChromeInputTarget = wasConnected && dictationTargetKey(for: previousPeerTarget) != dictationTargetKey(for: nextPeerTarget)
        } else {
            didChangeChromeInputTarget = false
        }
        peerTarget = nextPeerTarget
        saveCurrentPairingSession(message: message)
        applyConnectionStatus(
            .connected,
            allowsConnectedFeedback: !wasConnected || (didChangeChromeInputTarget && selectedSection == .dictation)
        )
        resetDictationForTargetChangeIfNeeded(from: previousPeerTarget, to: nextPeerTarget)
        Task { await sendRetryablePhotos() }
    }

    private func firstNonEmpty(_ values: String?...) -> String? {
        values.first { value in
            guard let value else { return false }
            return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        } ?? nil
    }

    func applyResultReceived(_ receipt: ScannerProtocol.ResultReceived) {
        guard let id = UUID(uuidString: receipt.resultId),
              let index = results.firstIndex(where: { $0.id == id })
        else {
            return
        }

        if receipt.insertedIntoCursor == false {
            if peerTarget?.isWebPageSession == true && receipt.savedToResults {
                let previousDeliveryState = results[index].deliveryState
                results[index].deliveryState = .sent
                if results[index].deliveryState != previousDeliveryState {
                    showCaptureDeliveryToast(for: results[index], state: .sent)
                }
                captureSuccessFeedback.notificationOccurred(.success)
                statusText = "Successfully sent to browser"
                targetHint = peerTarget?.displayText ?? "The web session received it."
                return
            }

            results[index].deliveryState = .failed
            playCaptureFailureFeedback()
            if receipt.savedToResults {
                showCaptureTypingFallbackToast(for: results[index])
            } else {
                showCaptureDeliveryToast(for: results[index], state: .failed)
            }
            let browserName = peerTarget?.browser ?? "Chrome"
            statusText = "\(browserName) received text"
            targetHint = "\(browserName) saved it, but no focused cursor target was available."
            return
        }

        let previousDeliveryState = results[index].deliveryState
        results[index].deliveryState = receipt.savedToResults ? .sent : .failed
        if results[index].deliveryState != previousDeliveryState {
            showCaptureDeliveryToast(for: results[index], state: results[index].deliveryState)
        }
        if receipt.insertedIntoCursor == true {
            captureSuccessFeedback.notificationOccurred(.success)
            statusText = results[index].kind == .barcode ? "Barcode inserted" : "Text inserted"
            if let cursorLabel = receipt.cursorTarget?.label, !cursorLabel.isEmpty {
                targetHint = "Inserted into \(cursorLabel)."
            }
        } else if !receipt.savedToResults {
            playCaptureFailureFeedback()
        }
    }

    func playCaptureFailureFeedback() {
        captureFailureImpactFeedback.impactOccurred(intensity: 1)
        captureFailureFeedback.notificationOccurred(.error)
    }

}
