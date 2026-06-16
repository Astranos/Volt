import SwiftUI

struct DictationView: View {
    @Environment(ScannerStore.self) private var store

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    DictationConnectionCard(
                        statusText: store.statusText,
                        isConnected: store.connectionStatus.isConnected,
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
                .padding()
            }
            .navigationTitle("Dictate")
            .safeAreaInset(edge: .bottom, spacing: 0) {
                DictationStartAccessory(
                    isRecording: store.dictation.isRecording,
                    isConnected: store.connectionStatus.isConnected,
                    statusText: store.connectionStatus.isConnected ? "Ready to dictate into Chrome" : store.targetHint,
                    action: toggleDictation
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
            store.dictation.stop()
            store.commitDictation()
        } else {
            store.beginDictationSession()
            Task { await store.dictation.start() }
        }
    }
}

private struct DictationConnectionCard: View {
    let statusText: String
    let isConnected: Bool
    let chromeSession: String
    let chromePage: String
    let cursorTarget: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(isConnected ? "Connected Chrome Session" : "Chrome Session", systemImage: isConnected ? "checkmark.circle.fill" : "link")
                .font(.headline)
                .foregroundStyle(isConnected ? .green : .secondary)

            VStack(spacing: 12) {
                DictationDetailRow(title: "Status", value: statusText, systemImage: "dot.radiowaves.left.and.right")
                DictationDetailRow(title: "Session", value: chromeSession, systemImage: "desktopcomputer")
                DictationDetailRow(title: "Chrome Page", value: chromePage, systemImage: "globe")
                DictationDetailRow(title: "Typing Into", value: cursorTarget, systemImage: "cursorarrow.click")
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 8))
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
                    .textSelection(.enabled)
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
                .textSelection(.enabled)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct DictationStartAccessory: View {
    let isRecording: Bool
    let isConnected: Bool
    let statusText: String
    let action: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text(statusText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)

            Button(action: action) {
                Label(isRecording ? "Stop Dictation" : "Start Dictation", systemImage: isRecording ? "stop.fill" : "mic.fill")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!isConnected && !isRecording)
            .accessibilityInputLabels([isRecording ? "Stop" : "Start"])
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
    }
}
