import SwiftUI

struct CaptureDock: View {
    let statusText: String
    let targetHint: String
    let resultCount: Int
    let latestResult: ScanResult?
    let isRecognizingText: Bool
    let onCapture: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            if let latestResult {
                LatestCaptureStrip(result: latestResult, count: resultCount)
            }

            HStack(spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(statusText)
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text(targetHint)
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                Button(action: onCapture) {
                    ZStack {
                        Circle()
                            .fill(.white)
                            .frame(width: 76, height: 76)
                        Circle()
                            .stroke(.white.opacity(0.55), lineWidth: 4)
                            .frame(width: 88, height: 88)
                        Image(systemName: isRecognizingText ? "hourglass" : "doc.viewfinder")
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundStyle(.black)
                    }
                }
                .disabled(isRecognizingText)
                .accessibilityLabel(isRecognizingText ? "Capturing document" : "Start capture")
            }
            .padding(18)
            .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(.white.opacity(0.12), lineWidth: 1)
            }
        }
        .padding(.horizontal, 18)
    }
}

struct ReviewCaptureDock: View {
    let statusText: String
    @Binding var text: String
    let onRetake: () -> Void
    let onSend: () -> Void

    private var hasText: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(statusText, systemImage: "doc.text.viewfinder")
                    .font(.headline)
                    .foregroundStyle(.white)
                Spacer()
                Text("\(text.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.55))
            }

            TextEditor(text: $text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .foregroundStyle(.white)
                .frame(height: 112)
                .padding(10)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(.white.opacity(0.1), lineWidth: 1)
                }

            HStack(spacing: 10) {
                Button("Retake", systemImage: "arrow.clockwise", action: onRetake)
                    .buttonStyle(.bordered)
                    .tint(.white)

                Button("Send", systemImage: "paperplane.fill", action: onSend)
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(!hasText)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(16)
        .background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(.white.opacity(0.12), lineWidth: 1)
        }
        .padding(.horizontal, 18)
    }
}

struct LatestCaptureStrip: View {
    let result: ScanResult
    let count: Int

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.text")
                .foregroundStyle(.white)
            Text(result.value)
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.82))
                .lineLimit(1)
            Spacer(minLength: 0)
            Text("\(count)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.white.opacity(0.64))
        }
        .padding(.horizontal, 14)
        .frame(height: 42)
        .background(.black.opacity(0.54), in: Capsule())
        .overlay {
            Capsule().stroke(.white.opacity(0.1), lineWidth: 1)
        }
    }
}

struct OcrReviewControls: View {
    let regionCount: Int
    let onRetake: () -> Void
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("Tap highlighted text")
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)

            HStack(spacing: 12) {
                Button(action: onRetake) {
                    Label("Retake", systemImage: "arrow.clockwise")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .frame(minWidth: 104, minHeight: 48)
                        .background(.black.opacity(0.86), in: Capsule())
                        .overlay {
                            Capsule().stroke(.white.opacity(0.22), lineWidth: 1)
                        }
                }

                Spacer()

                Label("\(regionCount)", systemImage: "text.viewfinder")
                    .font(.subheadline.monospacedDigit().bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 48)
                    .background(.black.opacity(0.86), in: Capsule())
                    .overlay {
                        Capsule().stroke(.white.opacity(0.22), lineWidth: 1)
                    }
                    .accessibilityLabel("\(regionCount) recognized text regions")

                Spacer()

                Button(action: onFinish) {
                    Label("Finish", systemImage: "checkmark")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .frame(minWidth: 104, minHeight: 48)
                        .background(.black.opacity(0.86), in: Capsule())
                        .overlay {
                            Capsule().stroke(.white.opacity(0.22), lineWidth: 1)
                        }
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 22)
        .background {
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.88), .black.opacity(0.98)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        }
    }
}
