import Observation
import CoreImage
import CoreImage.CIFilterBuiltins
import Security
import UIKit

@MainActor
@Observable
final class ScannerStore {
    static let pairedSessionsStorageKey = "volt.pairedScannerSessions.v2"

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

    let camera = CameraModel()
    let dictation = DictationModel()
    let contributorId = ScannerProtocol.makeContributorId()

    static let disconnectedPairingHint = "Use the Pair button next to the section title to connect to Chrome."

    init() {
        loadPairedSessions()
        dictation.onTranscriptChange = { [weak self] text in
            self?.handleDictationTranscriptChange(text)
        }
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
        return connection
    }()
    @ObservationIgnored let signaling = ScannerSignalingClient()
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
        guard canCancelReconnect else { return }
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
        statusText = "Reconnect canceled"
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
        let previousPeerTarget = peerTarget
        let nextPeerTarget = ScannerPeerTarget(
            chromeSessionId: chromeSessionId,
            sessionLabel: sessionLabel,
            tabTitle: message.cursorTarget?.tabTitle,
            tabURL: message.cursorTarget?.url,
            cursorLabel: message.cursorTarget?.label,
            browser: "Chrome"
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
            allowsConnectedFeedback: !didChangeChromeInputTarget || selectedSection == .dictation
        )
        resetDictationForTargetChangeIfNeeded(from: previousPeerTarget, to: nextPeerTarget)
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
            results[index].deliveryState = .failed
            statusText = "Chrome received text"
            targetHint = "Chrome saved it, but no focused cursor target was available."
            return
        }

        results[index].deliveryState = receipt.savedToResults ? .sent : .failed
        if receipt.insertedIntoCursor == true {
            statusText = results[index].kind == .barcode ? "Barcode inserted" : "Text inserted"
            if let cursorLabel = receipt.cursorTarget?.label, !cursorLabel.isEmpty {
                targetHint = "Inserted into \(cursorLabel)."
            }
        }
    }

}
