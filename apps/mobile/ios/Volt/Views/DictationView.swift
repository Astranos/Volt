import SwiftUI

struct DictationView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isTargetPickerPresented = false

    private var matchingResults: [ScanResult] {
        store.results
            .filter { $0.kind == .dictation }
            .sorted { $0.capturedAt > $1.capturedAt }
    }

    private var phase: SpeechDictationService.Phase { store.dictationPhase }

    var body: some View {
        NavigationStack {
            scrollContent
                .background(ScannerTabLayout.background)
                .navigationTitle("Dictate")
                .toolbar(.hidden, for: .navigationBar)
                .safeAreaInset(edge: .bottom, spacing: 0) { accessory }
                .sheet(isPresented: $isTargetPickerPresented) {
                    CloudTargetPickerSheet()
                }
                .modifier(DictationFeedbackModifier(phase: phase, outcome: store.dictationOutcome))
                .onChange(of: phase) { _, new in announce(for: new) }
                .onAppear {
                    store.selectedSection = .dictation
                    store.activeMode = .dictation
                }
                .onDisappear {
                    Task { await store.cancelLiveDictation() }
                }
                .onChange(of: store.cloudWorkspace.selectedTargetDeviceId) { _, _ in
                    store.republishLiveDictationDraftAfterTargetChange()
                }
        }
    }

    private var scrollContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                header

                ComputerAvailabilityCard {
                    isTargetPickerPresented = true
                }

                liveTranscriptCard

                if let error = store.dictationErrorMessage {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                CaptureModeCapturesSection(
                    mode: .dictation,
                    results: matchingResults,
                    onResend: resend,
                    onDelete: delete
                )
            }
            .padding(ScannerTabLayout.contentPadding)
            .padding(.top, ScannerTabLayout.topPadding)
            .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("Dictate")
                .font(.largeTitle.bold())
            Spacer()
            CloudTargetButton {
                isTargetPickerPresented = true
            }
        }
    }

    private var accessory: some View {
        DictationActionAccessory(
            phase: phase,
            level: store.dictationInputLevel,
            statusText: store.dictationDraftStatus,
            isTargetSelected: store.cloudWorkspace.selectedComputer != nil,
            action: toggleDictation
        )
    }

    private var liveTranscriptCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Label("Live Transcript", systemImage: phase == .listening ? "waveform" : "text.alignleft")
                    .font(.headline)
                Spacer(minLength: 8)
                DictationPhasePill(phase: phase)
            }

            Text(transcriptPlaceholder)
                .font(.title3)
                .foregroundStyle(store.dictationTranscript.isEmpty ? .secondary : .primary)
                .frame(maxWidth: .infinity, minHeight: 140, alignment: .topLeading)
                .padding(14)
                .background(.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(phase.accentColor.opacity(phase == .listening ? 0.55 : 0), lineWidth: 2)
                )
                .animation(.easeOut(duration: 0.2), value: phase)
                .accessibilityLabel("Dictation transcript")

            Text(store.dictationDraftStatus)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var transcriptPlaceholder: String {
        if !store.dictationTranscript.isEmpty { return store.dictationTranscript }
        switch phase {
        case .idle:
            return "Start dictation to stream words to Chrome."
        case .preparing:
            return "Opening the microphone — hold on before you speak."
        case .listening:
            return "Speak now…"
        case .finishing:
            return "Catching your last words…"
        }
    }

    private func toggleDictation() {
        Task {
            if store.isDictating {
                await store.stopLiveDictation()
            } else {
                await store.startLiveDictation()
            }
        }
    }

    private func announce(for phase: SpeechDictationService.Phase) {
        let message: String? = switch phase {
        case .listening: "Microphone ready. Speak now."
        case .finishing: "Finishing. Keep still for a moment."
        default: nil
        }
        guard let message else { return }
        AccessibilityNotification.Announcement(message).post()
    }

    private func resend(_ result: ScanResult) {
        Task { await store.insertResultIntoComputer(id: result.id) }
    }

    private func delete(_ result: ScanResult) {
        store.removeResult(id: result.id)
    }
}

// MARK: - Haptics

/// Everything the hands feel: when the mic opens, when Stop registers, and how the
/// dictation ended.
private struct DictationFeedbackModifier: ViewModifier {
    let phase: SpeechDictationService.Phase
    let outcome: DictationOutcomeSignal?

    func body(content: Content) -> some View {
        // Split into steps: chaining three generic `sensoryFeedback` calls in one
        // expression blows past the type checker's budget.
        let ready = content.sensoryFeedback(
            SensoryFeedback.success,
            trigger: phase,
            // The moment the mic is genuinely live — the cue people wait for instead
            // of talking into a session that has not opened yet.
            condition: { (_: SpeechDictationService.Phase, new: SpeechDictationService.Phase) -> Bool in
                new == .listening
            }
        )
        let stopping = ready.sensoryFeedback(
            SensoryFeedback.impact(weight: .medium),
            trigger: phase,
            // Acknowledge the Stop tap right away, because the mic deliberately stays
            // open for a beat afterwards to catch the last word.
            condition: { (old: SpeechDictationService.Phase, new: SpeechDictationService.Phase) -> Bool in
                old == .listening && new == .finishing
            }
        )
        return stopping.sensoryFeedback(
            trigger: outcome,
            { (_: DictationOutcomeSignal?, new: DictationOutcomeSignal?) -> SensoryFeedback? in
                Self.feedback(for: new)
            }
        )
    }

    private static func feedback(for outcome: DictationOutcomeSignal?) -> SensoryFeedback? {
        guard let outcome else { return nil }
        switch outcome.kind {
        case .saved: return SensoryFeedback.success
        case .discarded: return SensoryFeedback.warning
        case .failed: return SensoryFeedback.error
        }
    }
}

// MARK: - Phase presentation

private extension SpeechDictationService.Phase {
    var accentColor: Color {
        switch self {
        case .idle: .secondary
        case .preparing: .orange
        case .listening: .green
        case .finishing: .orange
        }
    }

    var pillTitle: String {
        switch self {
        case .idle: "Idle"
        case .preparing: "Getting ready"
        case .listening: "Ready — speak"
        case .finishing: "Finishing"
        }
    }
}

/// The single indicator that answers "can I talk yet?" and "can I let go yet?".
private struct DictationPhasePill: View {
    let phase: SpeechDictationService.Phase
    @State private var isPulsing = false

    var body: some View {
        HStack(spacing: 6) {
            switch phase {
            case .preparing, .finishing:
                ProgressView()
                    .controlSize(.mini)
            case .listening:
                Circle()
                    .fill(Color.green)
                    .frame(width: 8, height: 8)
                    .scaleEffect(isPulsing ? 1.45 : 1)
                    .opacity(isPulsing ? 0.5 : 1)
                    .animation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: isPulsing)
            case .idle:
                Circle()
                    .fill(Color.secondary.opacity(0.4))
                    .frame(width: 8, height: 8)
            }

            Text(phase.pillTitle)
                .font(.caption.weight(.semibold))
                .foregroundStyle(phase == .idle ? Color.secondary : phase.accentColor)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            Capsule().fill(phase.accentColor.opacity(phase == .idle ? 0.08 : 0.14))
        )
        .onAppear { isPulsing = phase == .listening }
        .onChange(of: phase) { _, new in isPulsing = new == .listening }
        .accessibilityLabel(phase.pillTitle)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// Live input level, so a silent transcript is obviously a microphone problem rather
/// than a mystery.
private struct DictationLevelMeter: View {
    let level: Double
    let isActive: Bool

    private let barCount = 7

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<barCount, id: \.self) { index in
                let threshold = Double(index + 1) / Double(barCount)
                let isLit = isActive && level >= threshold * 0.85
                Capsule()
                    .fill(isLit ? Color.green : Color.secondary.opacity(0.25))
                    .frame(width: 4, height: barHeight(for: index))
            }
        }
        .animation(.easeOut(duration: 0.12), value: level)
        .accessibilityHidden(true)
    }

    private func barHeight(for index: Int) -> CGFloat {
        let peak = Double(min(index, barCount - 1 - index))
        return 8 + peak * 4
    }
}

/// Dictation-specific bottom bar. The shared accessory only knows enabled/disabled,
/// and this screen needs four distinct states to keep people from talking too early
/// or cutting themselves off.
private struct DictationActionAccessory: View {
    let phase: SpeechDictationService.Phase
    let level: Double
    let statusText: String
    let isTargetSelected: Bool
    let action: () -> Void

    private var isBusy: Bool { phase == .preparing || phase == .finishing }
    private var isEnabled: Bool { !isBusy && (phase == .listening || isTargetSelected) }

    private var title: String {
        switch phase {
        case .idle: "Start Dictation"
        case .preparing: "Getting ready…"
        case .listening: "Stop Dictation"
        case .finishing: "Catching last words…"
        }
    }

    private var background: Color {
        switch phase {
        case .listening: .red
        case .idle: isTargetSelected ? .green : .gray
        case .preparing, .finishing: .gray
        }
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Text(statusText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .center)

                if phase == .listening {
                    DictationLevelMeter(level: level, isActive: true)
                        .transition(.opacity)
                }
            }

            Button(action: action) {
                HStack(spacing: 8) {
                    if isBusy {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.white)
                    } else {
                        Image(systemName: phase == .listening ? "stop.fill" : "mic.fill")
                    }
                    Text(title)
                }
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(
                    background,
                    in: RoundedRectangle(
                        cornerRadius: ScannerTabLayout.primaryActionCornerRadius,
                        style: .continuous
                    )
                )
                .opacity(isEnabled ? 1 : ScannerTabLayout.disabledPrimaryActionOpacity)
            }
            .buttonStyle(.plain)
            .disabled(!isEnabled)
            .animation(.easeOut(duration: 0.18), value: phase)
            .accessibilityLabel(title)
            .accessibilityHint(accessibilityHint)
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
    }

    private var accessibilityHint: String {
        switch phase {
        case .idle:
            isTargetSelected ? "Starts dictating to the selected computer." : "Choose an online computer before dictating."
        case .preparing:
            "Waiting for the microphone. You will feel a tap when it is ready."
        case .listening:
            "Stops dictating. The last moment of audio is still captured."
        case .finishing:
            "Saving the end of your dictation."
        }
    }
}
