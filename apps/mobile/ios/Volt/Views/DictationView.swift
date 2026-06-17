import SwiftUI

struct DictationView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isPairingScannerPresented = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ScannerSectionHeader(title: "Dictate") {
                        isPairingScannerPresented = true
                    }

                    DictationConnectionCard(
                        chromeSession: chromeSession,
                        chromePage: chromePage,
                        cursorTarget: cursorTarget
                    )

                    DictationTranscriptCard(
                        transcript: store.dictation.transcript,
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
            .fullScreenCover(isPresented: $isPairingScannerPresented) {
                PairingScanSessionView(isPresented: $isPairingScannerPresented)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                DictationStartAccessory(
                    isRecording: store.dictation.isRecording,
                    isConnected: store.connectionStatus.isConnected,
                    statusText: store.connectionStatus.isConnected ? "Ready to dictate into Chrome" : store.targetHint,
                    toggleAction: toggleDictation,
                    holdStartAction: startDictation,
                    holdEndAction: stopDictation
                )
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
        store.finishDictation()
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
    let isRecording: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(isRecording ? "Listening" : "Transcript", systemImage: isRecording ? "waveform" : "text.quote")
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
}

private struct DictationStartAccessory: View {
    let isRecording: Bool
    let isConnected: Bool
    let statusText: String
    let toggleAction: () -> Void
    let holdStartAction: () -> Void
    let holdEndAction: () -> Void
    @State private var pressStart: Date?
    @State private var didStartFromHold = false

    private let holdDelay: Duration = .milliseconds(260)

    var body: some View {
        VStack(spacing: 10) {
            Text(statusText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)

            Label(isRecording ? "Stop Dictation" : "Start Dictation", systemImage: isRecording ? "stop.fill" : "mic.fill")
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(isConnected || isRecording ? Color.accentColor : Color.secondary, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .opacity(isConnected || isRecording ? 1 : 0.55)
                .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .gesture(pressGesture)
                .accessibilityAddTraits(.isButton)
                .accessibilityLabel(isRecording ? "Stop Dictation" : "Start Dictation")
                .accessibilityHint(isConnected || isRecording ? "" : statusText)
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
    }

    private var pressGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { _ in
                guard isConnected || isRecording else { return }
                if pressStart == nil {
                    pressStart = .now
                    scheduleHoldStart()
                }
            }
            .onEnded { _ in
                guard isConnected || isRecording else {
                    resetPress()
                    return
                }
                if didStartFromHold {
                    holdEndAction()
                } else {
                    toggleAction()
                }
                resetPress()
            }
    }

    private func scheduleHoldStart() {
        Task {
            try? await Task.sleep(for: holdDelay)
            await MainActor.run {
                guard pressStart != nil, !didStartFromHold, isConnected, !isRecording else { return }
                didStartFromHold = true
                holdStartAction()
            }
        }
    }

    private func resetPress() {
        pressStart = nil
        didStartFromHold = false
    }
}
