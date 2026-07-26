import Foundation

/// A one-shot signal that a dictation finished, carrying how it ended. The tick keeps
/// two identical outcomes in a row distinguishable so the haptic fires both times.
struct DictationOutcomeSignal: Equatable {
    enum Kind: Equatable {
        case saved
        case discarded
        case failed
    }

    let kind: Kind
    let tick: Int
}

@MainActor
extension ScannerStore {
    var dictationTranscript: String { speechDictation.transcript }
    var dictationPhase: SpeechDictationService.Phase { speechDictation.phase }
    var isDictating: Bool { speechDictation.isListening }
    /// True while the pipeline is coming up or draining — the button must not accept
    /// another tap in either window.
    var isDictationBusy: Bool { speechDictation.isPreparing || speechDictation.isFinishing }
    var dictationInputLevel: Double { speechDictation.inputLevel }
    var dictationAuthorization: SpeechDictationService.Authorization { speechDictation.authorization }
    var dictationErrorMessage: String? { speechDictation.errorMessage ?? dictationPublishError }

    func startLiveDictation() async {
        guard speechDictation.phase == .idle else { return }
        guard cloudWorkspace.selectedComputer != nil else {
            dictationPublishError = "Choose an online computer before dictating."
            dictationDraftStatus = "Choose a computer to show live text."
            return
        }

        dictationPublishError = nil
        dictationSessionId = UUID()
        dictationDraftStatus = "Getting the mic ready — wait for the green light."
        statusText = "Preparing dictation"
        await speechDictation.start { [weak self] text in
            self?.handleLiveDictationTranscript(text)
        }
        if speechDictation.errorMessage != nil {
            await clearLiveDictationDraft()
            dictationSessionId = nil
            dictationDraftStatus = "Dictation unavailable"
            statusText = "Dictation unavailable"
            return
        }
        if speechDictation.isListening {
            dictationDraftStatus = "Listening — speak now."
            statusText = "Dictating to \(cloudWorkspace.selectedComputer?.label ?? "computer")"
        }
    }

    func stopLiveDictation() async {
        guard !speechDictation.isFinishing else { return }
        dictationDraftStatus = "Catching your last words…"
        let value = await speechDictation.stop()
        dictationDraftTask?.cancel()
        dictationDraftTask = nil
        guard let sessionId = dictationSessionId else {
            dictationDraftStatus = "Tap Start Dictation to begin."
            return
        }

        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        defer {
            dictationSessionId = nil
        }

        if trimmed.isEmpty {
            await cloudWorkspace.clearDictationDraft(draftId: sessionId.uuidString.lowercased())
            speechDictation.clearTranscript()
            dictationDraftStatus = "No speech captured"
            statusText = "Dictation canceled"
            noteDictationOutcome(.discarded)
            return
        }

        let result = ScanResult(
            id: sessionId,
            kind: .dictation,
            source: .dictation,
            value: trimmed,
            format: "dictation",
            deliveryState: initialDeliveryState
        )
        guard saveResultLocally(result) else {
            await cloudWorkspace.clearDictationDraft(draftId: sessionId.uuidString.lowercased())
            dictationDraftStatus = "Could not save dictation"
            noteDictationOutcome(.failed)
            return
        }

        await cloudWorkspace.clearDictationDraft(draftId: sessionId.uuidString.lowercased())
        sendCaptureResult(result, insertIntoCursor: true)
        dictationDraftStatus = cloudWorkspace.selectedComputer == nil
            ? "Saved to Volt"
            : "Sent to \(cloudWorkspace.selectedComputer?.label ?? "computer")"
        statusText = cloudWorkspace.selectedComputer == nil
            ? "Dictation saved"
            : "Dictation insertion queued"
        speechDictation.clearTranscript()
        noteDictationOutcome(.saved)
    }

    func cancelLiveDictation() async {
        // A stop already in flight owns the teardown; yanking it here would drop the
        // tail it is busy draining.
        guard !speechDictation.isFinishing else { return }
        await speechDictation.cancel()
        dictationDraftTask?.cancel()
        dictationDraftTask = nil
        await clearLiveDictationDraft()
        dictationSessionId = nil
        dictationPublishError = nil
        dictationDraftStatus = "Tap Start Dictation to begin."
    }

    func republishLiveDictationDraftAfterTargetChange() {
        guard isDictating else { return }
        handleLiveDictationTranscript(speechDictation.transcript)
    }

    private func handleLiveDictationTranscript(_ text: String) {
        dictationDraftTask?.cancel()
        guard let sessionId = dictationSessionId else { return }
        guard cloudWorkspace.selectedComputer != nil else {
            dictationDraftStatus = "Choose a computer to show live text."
            return
        }

        let draftId = sessionId.uuidString.lowercased()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        dictationDraftStatus = trimmed.isEmpty
            ? "Listening — speak now."
            : "Updating the Chrome cursor…"
        dictationDraftTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled, let self else { return }
            if trimmed.isEmpty {
                await self.cloudWorkspace.clearDictationDraft(draftId: draftId)
                self.dictationDraftStatus = "Listening — speak now."
                self.dictationPublishError = nil
                return
            }
            if let error = await self.cloudWorkspace.updateDictationDraft(draftId: draftId, text: text) {
                self.dictationPublishError = error
                self.dictationDraftStatus = "Live cursor typing unavailable"
                return
            }
            self.dictationPublishError = nil
            if let label = self.cloudWorkspace.selectedComputer?.label {
                self.dictationDraftStatus = "Typing at the cursor on \(label)"
            } else {
                self.dictationDraftStatus = "Live draft published"
            }
        }
    }

    private func clearLiveDictationDraft() async {
        guard let sessionId = dictationSessionId else { return }
        await cloudWorkspace.clearDictationDraft(draftId: sessionId.uuidString.lowercased())
    }
}
