import SwiftUI

struct ExtractedTextActionCard: View {
    let text: String
    let rawText: String
    let isShowingRaw: Bool
    let isCleaning: Bool
    let onToggleRepresentation: () -> Void
    let onSend: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Extracted Text")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.black)

                    Text(text)
                        .font(.title3)
                        .foregroundStyle(.black.opacity(0.62))
                        .lineLimit(3)
                        .minimumScaleFactor(0.78)

                    if isCleaning {
                        Label("Cleaning…", systemImage: "wand.and.sparkles")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.black.opacity(0.56))
                    }
                }

                Spacer(minLength: 0)

                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.black.opacity(0.68))
                        .frame(width: 34, height: 34)
                        .background(.black.opacity(0.1), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }

            VStack(spacing: 12) {
                Button(action: onToggleRepresentation) {
                    Label(isShowingRaw ? "Cleaned" : "Raw", systemImage: isShowingRaw ? "wand.and.sparkles" : "doc.text")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .frame(height: 64)
                        .background(.black.opacity(0.12), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isCleaning)

                Button(action: onSend) {
                    Label("Send", systemImage: "paperplane.fill")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 64)
                        .background(Color.green, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 28)
        .frame(width: 340)
        .background(
            Color.white.opacity(0.9),
            in: RoundedRectangle(cornerRadius: 36, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 36, style: .continuous)
                .stroke(.white.opacity(0.42), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.22), radius: 28, y: 16)
        .accessibilityElement(children: .contain)
    }
}

struct FocusReticle: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .stroke(.yellow, lineWidth: 2)
            .frame(width: 74, height: 74)
            .overlay {
                Circle()
                    .fill(.yellow)
                    .frame(width: 8, height: 8)
            }
            .transition(.scale.combined(with: .opacity))
    }
}

struct OcrReviewControls: View {
    let regionCount: Int
    let targetLabel: String
    let targetSystemImage: String
    let onChangeTarget: () -> Void
    let onRetake: () -> Void
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("Tap highlighted text")
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)

            // Switching the destination here keeps the recognized text, so there's no need to
            // retake the photo just to send it to a different computer.
            Button(action: onChangeTarget) {
                HStack(spacing: 8) {
                    Image(systemName: targetSystemImage)
                        .foregroundStyle(.green)
                    Text("Send to")
                        .foregroundStyle(.white.opacity(0.68))
                    Text(targetLabel)
                        .fontWeight(.bold)
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption.bold())
                        .foregroundStyle(.white.opacity(0.68))
                }
                .font(.subheadline)
                .foregroundStyle(.white)
                .padding(.horizontal, 18)
                .frame(minHeight: 44)
                .background(.black.opacity(0.86), in: Capsule())
                .overlay {
                    Capsule().stroke(.green.opacity(0.55), lineWidth: 1)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Send to \(targetLabel)")
            .accessibilityHint("Choose a different computer without retaking the photo.")

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

/// Confirms a photo the moment it is taken. Silent mode mutes the shutter sound, so the viewfinder
/// blinks dark and the phone taps once each time `trigger` changes.
private struct ShutterFeedbackModifier: ViewModifier {
    let trigger: Int

    func body(content: Content) -> some View {
        content
            .overlay {
                Color.black
                    .keyframeAnimator(initialValue: 0.0, trigger: trigger) { flash, opacity in
                        flash.opacity(opacity)
                    } keyframes: { _ in
                        LinearKeyframe(0.75, duration: 0.04)
                        CubicKeyframe(0, duration: 0.22)
                    }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .sensoryFeedback(.impact(weight: .medium), trigger: trigger)
    }
}

extension View {
    func shutterFeedback(trigger: Int) -> some View {
        modifier(ShutterFeedbackModifier(trigger: trigger))
    }
}
