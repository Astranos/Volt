import SwiftUI

struct DictationView: View {
    @Environment(ScannerStore.self) private var store

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text(store.dictation.transcript.isEmpty ? "Ready" : store.dictation.transcript)
                    .font(.title3)
                    .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
                    .padding()
                    .background(.background.secondary, in: RoundedRectangle(cornerRadius: 8))

                Button {
                    if store.dictation.isRecording {
                        store.dictation.stop()
                        store.commitDictation()
                    } else {
                        store.beginDictationSession()
                        Task { await store.dictation.start() }
                    }
                } label: {
                    Label(store.dictation.isRecording ? "Stop" : "Start", systemImage: store.dictation.isRecording ? "stop.fill" : "mic.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                if let error = store.dictation.errorMessage {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Dictate")
        }
    }
}
