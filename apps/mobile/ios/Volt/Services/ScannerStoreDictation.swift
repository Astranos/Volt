import Foundation
import UIKit

@MainActor
extension ScannerStore {
    func prepareDictation() async {
        _ = await dictation.requestAccess()
    }

    func startDictation(allowsFeedback: Bool = true) async {
        guard connectionStatus.isConnected else { return }
        cancelDictationGraceStop()
        let startToken = UUID()
        dictationStartToken = startToken
        shouldStopDictationAfterStart = false
        dictation.clearTranscript()
        beginDictationSession()
        await dictation.start()
        guard dictationStartToken == startToken else { return }
        if dictation.isRecording {
            if allowsFeedback {
                dictationNotificationFeedback.notificationOccurred(.success)
            }
            scheduleDictationRequestLimit(for: startToken)
            if shouldStopDictationAfterStart {
                finishDictation()
            }
        } else {
            cancelDictationRequestLimit()
            sendDictation(nil, phase: "stopped")
            dictationSessionId = nil
            lastDictationPartialText = ""
            dictationNotificationFeedback.notificationOccurred(.error)
        }
    }

    func finishDictation() {
        cancelDictationGraceStop()
        guard dictation.isRecording else {
            shouldStopDictationAfterStart = true
            return
        }
        dictationStartToken = nil
        shouldStopDictationAfterStart = false
        cancelDictationRequestLimit()
        let wasRecording = dictation.isRecording
        dictation.stop()
        if wasRecording {
            dictationImpactFeedback.impactOccurred(intensity: 0.7)
        }
        commitDictation()
    }

    func finishDictationAfterGrace() {
        guard dictation.isRecording || dictation.isStarting else { return }
        dictationGraceStopTask?.cancel()
        let delay = dictationReleaseGraceDelay
        dictationGraceStopTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.dictationGraceStopTask = nil
                self?.finishDictation()
            }
        }
    }

    func commitDictation() {
        let text = dictation.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            let result = ScanResult(kind: .dictation, source: .dictation, value: text, format: "dictation", deliveryState: initialDeliveryState)
            results.insert(result, at: 0)
            sendDictation(text, phase: "final")
        }
        sendDictation(nil, phase: "stopped")
        dictationSessionId = nil
        lastDictationPartialText = ""
    }

    func beginDictationSession() {
        dictation.clearTranscript()
        dictationSessionId = ScannerProtocol.makeMessageId("dictation")
        lastDictationPartialText = ""
        sendDictation(nil, phase: "started")
    }

    func handleDictationTranscriptChange(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text != lastDictationPartialText, dictationSessionId != nil else { return }
        lastDictationPartialText = text
        sendDictation(text, phase: "partial")
    }

    func resetDictationForTargetChangeIfNeeded(from previousTarget: ScannerPeerTarget?, to nextTarget: ScannerPeerTarget) {
        let nextKey = dictationTargetKey(for: nextTarget)
        defer { dictationTargetKey = nextKey }
        guard let previousTarget else { return }
        guard dictationTargetKey(for: previousTarget) != nextKey else { return }

        lastDictationPartialText = ""
        let hadDictationState = dictation.isStarting || dictation.isRecording || !dictation.transcript.isEmpty || dictationSessionId != nil
        guard hadDictationState else { return }

        if dictation.isRecording || dictation.isStarting {
            stopDictationForTargetChange()
            Task { await startDictation(allowsFeedback: selectedSection == .dictation) }
        } else {
            dictation.clearTranscript()
            dictationSessionId = nil
        }
    }

    func stopDictationForTargetChange() {
        dictationStartToken = nil
        shouldStopDictationAfterStart = false
        cancelDictationGraceStop()
        cancelDictationRequestLimit()
        dictation.stop()
        sendDictation(nil, phase: "stopped")
        dictationSessionId = nil
    }

    func dictationTargetKey(for target: ScannerPeerTarget) -> String {
        [
            target.chromeSessionId,
            target.tabURL,
            target.tabTitle,
            target.cursorLabel,
        ]
            .map { value in
                value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            }
            .joined(separator: "\u{1F}")
    }

    func scheduleDictationRequestLimit(for token: UUID) {
        cancelDictationRequestLimit()
        let limit = dictationRequestLimit
        dictationLimitTask = Task { [weak self] in
            try? await Task.sleep(for: limit)
            await MainActor.run {
                guard let self, self.dictationStartToken == token, self.dictation.isRecording else { return }
                self.statusText = "Dictation stopped"
                self.targetHint = "Start again to continue dictating."
                self.finishDictation()
            }
        }
    }

    func cancelDictationRequestLimit() {
        dictationLimitTask?.cancel()
        dictationLimitTask = nil
    }

    func cancelDictationGraceStop() {
        dictationGraceStopTask?.cancel()
        dictationGraceStopTask = nil
    }

    func sendDictation(_ text: String?, phase: String) {
        guard connectionStatus.isConnected else { return }
        let sessionId = dictationSessionId ?? ScannerProtocol.makeMessageId("dictation")
        dictationSessionId = sessionId
        do {
            try connection.sendControl(ScannerProtocol.dictationMessage(
                sessionId: sessionId,
                phase: phase,
                text: text,
                insertIntoCursor: true
            ))
        } catch {
            applyConnectionStatus(.error(error.localizedDescription))
        }
    }
}
