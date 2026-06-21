import SwiftUI

struct DictationView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isSessionsPresented = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ScannerSectionHeader(
                        title: "Dictate",
                        onConnectionControlTapped: {
                            isSessionsPresented = true
                        }
                    )

                    DictationConnectionCard(
                        chromeSession: chromeSession,
                        chromePage: chromePage,
                        cursorTarget: cursorTarget
                    )

                    DictationTranscriptCard(
                        transcript: store.dictation.transcript,
                        isStarting: store.dictation.isStarting,
                        isRecording: store.dictation.isRecording
                    )

                    if let error = store.dictation.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Dictate")
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $isSessionsPresented) {
                PairingSessionsView()
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                DictationStartAccessory(
                    isRecording: store.dictation.isRecording,
                    isStarting: store.dictation.isStarting,
                    isConnected: store.connectionStatus.isConnected,
                    statusText: dictationStatusText,
                    toggleAction: toggleDictation,
                    holdStartAction: startDictation,
                    holdEndAction: stopDictation
                )
            }
            .onAppear {
                store.selectedSection = .dictation
                store.activeMode = .dictation
            }
            .task {
                if !ScreenshotScenario.isEnabled {
                    await store.prepareDictation()
                }
            }
        }
    }

    private var chromeSession: String {
        store.peerTarget?.chromeSessionId
            ?? store.pairingSession?.sessionId
            ?? "No Chrome session connected"
    }

    private var chromePage: String {
        if let tabTitle = store.peerTarget?.tabTitle, !tabTitle.isEmpty {
            tabTitle
        } else if let tabURL = store.peerTarget?.tabURL, !tabURL.isEmpty {
            tabURL
        } else {
            "Waiting for Chrome page"
        }
    }

    private var cursorTarget: String {
        guard store.connectionStatus.isConnected else {
            return "Connect to Chrome first"
        }
        if let cursorLabel = store.peerTarget?.cursorLabel, !cursorLabel.isEmpty {
            return cursorLabel
        }
        return "No text input focused"
    }

    private var dictationStatusText: String {
        if store.dictation.isStarting {
            "Starting microphone..."
        } else if store.dictation.isRecording {
            "Listening"
        } else if store.connectionStatus.isConnected {
            "Ready to dictate into Chrome"
        } else {
            store.targetHint
        }
    }

    private func toggleDictation() {
        if store.dictation.isRecording {
            stopDictation()
        } else {
            startDictation()
        }
    }

    private func startDictation() {
        Task { await store.startDictation() }
    }

    private func stopDictation() {
        store.finishDictationAfterGrace()
    }
}

private struct DictationConnectionCard: View {
    let chromeSession: String
    let chromePage: String
    let cursorTarget: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Chrome Session", systemImage: "desktopcomputer")
                .font(.headline)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                DictationDetailRow(title: "Session", value: chromeSession, systemImage: "desktopcomputer")
                DictationDetailRow(title: "Chrome Page", value: chromePage, systemImage: "globe")
                DictationDetailRow(title: "Typing Into", value: cursorTarget, systemImage: "cursorarrow")
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct DictationDetailRow: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct DictationTranscriptCard: View {
    let transcript: String
    let isStarting: Bool
    let isRecording: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(transcriptTitle, systemImage: transcriptIcon)
                .font(.headline)

            Text(transcript.isEmpty ? "Dictated text will appear here while you speak." : transcript)
                .font(.title3)
                .foregroundStyle(transcript.isEmpty ? .secondary : .primary)
                .frame(maxWidth: .infinity, minHeight: 160, alignment: .topLeading)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var transcriptTitle: String {
        if isRecording {
            "Listening"
        } else if isStarting {
            "Starting"
        } else {
            "Transcript"
        }
    }

    private var transcriptIcon: String {
        if isRecording || isStarting {
            "waveform"
        } else {
            "text.quote"
        }
    }
}

private struct DictationStartAccessory: View {
    let isRecording: Bool
    let isStarting: Bool
    let isConnected: Bool
    let statusText: String
    let toggleAction: () -> Void
    let holdStartAction: () -> Void
    let holdEndAction: () -> Void
    @State private var pressStart: Date?
    @State private var didStartRecordingFromPress = false

    private let pushToTalkThreshold: TimeInterval = 0.35
    private let pressFeedback = UIImpactFeedbackGenerator(style: .medium)
    private let startFeedback = UIImpactFeedbackGenerator(style: .heavy)
    private let stopFeedback = UINotificationFeedbackGenerator()

    var body: some View {
        VStack(spacing: 10) {
            Text(statusText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)

            Label(buttonTitle, systemImage: buttonIcon)
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(buttonColor, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .opacity(isConnected || isRecording || isStarting ? 1 : 0.55)
                .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .gesture(pressGesture)
                .accessibilityAddTraits(.isButton)
                .accessibilityLabel(buttonTitle)
                .accessibilityHint(isConnected || isRecording || isStarting ? "" : statusText)
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
    }

    private var buttonColor: Color {
        if isRecording {
            .red
        } else if isStarting {
            .orange
        } else if isConnected {
            .accentColor
        } else {
            .secondary
        }
    }

    private var buttonTitle: String {
        if isRecording {
            "Stop Dictation"
        } else if isStarting {
            "Starting Dictation"
        } else {
            "Start Dictation"
        }
    }

    private var buttonIcon: String {
        if isRecording {
            "stop.fill"
        } else if isStarting {
            "waveform"
        } else {
            "mic.fill"
        }
    }

    private var pressGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { _ in
                guard isConnected || isRecording || isStarting else { return }
                if pressStart == nil {
                    pressStart = .now
                    if !isRecording && !isStarting {
                        didStartRecordingFromPress = true
                        startFeedback.prepare()
                        startFeedback.impactOccurred(intensity: 1)
                        holdStartAction()
                    } else {
                        pressFeedback.impactOccurred(intensity: 1)
                    }
                }
            }
            .onEnded { _ in
                guard isConnected || isRecording || isStarting else {
                    resetPress()
                    return
                }
                if didStartRecordingFromPress {
                    if shouldStopAfterPress {
                        stopFeedback.notificationOccurred(.success)
                        holdEndAction()
                    }
                } else if isRecording {
                    stopFeedback.notificationOccurred(.success)
                    holdEndAction()
                } else {
                    toggleAction()
                }
                resetPress()
            }
    }

    private var shouldStopAfterPress: Bool {
        guard let pressStart else { return false }
        return Date.now.timeIntervalSince(pressStart) >= pushToTalkThreshold
    }

    private func resetPress() {
        pressStart = nil
        didStartRecordingFromPress = false
    }
}
