import SwiftUI

/// Progress of the TestFlight-only OCR flag action shown on the extracted text card.
enum OcrFlagState: Equatable {
    case idle
    case sending
    case sent
    case failed
}

struct ExtractedTextActionCard: View {
    let text: String
    let rawText: String
    let isShowingRaw: Bool
    let isCleaning: Bool
    let onToggleRepresentation: () -> Void
    let onSend: (String) -> Void
    let onDismiss: () -> Void
    /// Owned by the presenting view so it can lift the card above the keyboard and close it.
    var inputFocus: FocusState<Bool>.Binding
    /// The OCR photo clipped to the selected text, so the user can check what was read before sending.
    var snippet: UIImage? = nil
    /// TestFlight-only. When nil the Flag button is hidden (App Store builds, App Clip).
    var flagState: OcrFlagState? = nil
    /// Receives the field's current text, so a value the user corrected travels with the flag.
    var onFlag: ((String) -> Void)? = nil
    /// Always editable: some sites reject characters OCR keeps, so the value can be fixed in place.
    @State private var draft = ""

    private var outgoingText: String {
        draft
    }

    /// The user typed over the OCR value, so the Raw/Cleaned toggle turns into Reset.
    private var isEdited: Bool {
        draft != text
    }

    private var canSend: Bool {
        !outgoingText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let snippet {
                OcrSnippetView(image: snippet)
            }

            HStack(alignment: .center, spacing: 10) {
                Text("Extracted Text")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.black)

                Spacer(minLength: 0)

                if let flagState, let onFlag {
                    OcrFlagButton(state: flagState, action: { onFlag(draft) })
                }

                Group {
                    if isEdited {
                        Button(action: resetDraft) {
                            headerIcon("arrow.uturn.backward")
                        }
                        .accessibilityLabel("Reset")
                        .accessibilityHint("Puts back the text OCR read.")
                    } else {
                        Button(action: onToggleRepresentation) {
                            headerIcon(isShowingRaw ? "wand.and.sparkles" : "doc.text")
                        }
                        .accessibilityLabel(isShowingRaw ? "Cleaned" : "Raw")
                        .disabled(isCleaning)
                    }
                }
                .buttonStyle(.plain)
            }

            Group {
                HStack(alignment: .center, spacing: 8) {
                    TextField("Text to send", text: $draft, axis: .vertical)
                        .font(.title3)
                        .foregroundStyle(.black)
                        .lineLimit(1...4)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .focused(inputFocus)
                        .accessibilityIdentifier("extracted-text-field")

                    // Shown inside the field so the card keeps its height when cleanup finishes.
                    if isCleaning {
                        Label("Cleaning…", systemImage: "wand.and.sparkles")
                            .labelStyle(.iconOnly)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.green)
                            .symbolEffect(.pulse, options: .repeating)
                            .frame(width: 28, height: 28)
                            .transition(.opacity)
                    }

                    if inputFocus.wrappedValue {
                        Button {
                            inputFocus.wrappedValue = false
                        } label: {
                            Image(systemName: "keyboard.chevron.compact.down")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(.black.opacity(0.6))
                                .frame(width: 34, height: 34)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Hide keyboard")
                    }
                }
                .padding(.leading, 14)
                .padding(.trailing, inputFocus.wrappedValue ? 4 : 14)
                .padding(.vertical, 10)
                .background(.black.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(inputFocus.wrappedValue ? Color.green.opacity(0.7) : .clear, lineWidth: 1.5)
                }
                .animation(.easeOut(duration: 0.2), value: isCleaning)
            }

            HStack(spacing: 12) {
                Button(action: onDismiss) {
                    Label("Close", systemImage: "xmark")
                        .secondaryActionStyle()
                }
                .buttonStyle(.plain)
                .frame(width: 128)

                Button(action: send) {
                    Label("Send", systemImage: "paperplane.fill")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Color.green.opacity(canSend ? 1 : 0.4), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
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
        .onAppear {
            draft = text
        }
        .onChange(of: text) { oldText, newText in
            // Cleanup finishing or Raw/Cleaned switching refreshes the field unless the user typed over it.
            if draft == oldText {
                draft = newText
            }
        }
        .onChange(of: draft) { _, newDraft in
            // A vertical field turns Return into a newline; treat it as Done and close the keyboard.
            guard newDraft.contains("\n") else { return }
            draft = newDraft.replacingOccurrences(of: "\n", with: "")
            inputFocus.wrappedValue = false
        }
    }

    private func headerIcon(_ systemName: String) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(.black.opacity(0.68))
            .frame(width: 34, height: 34)
            .background(.black.opacity(0.1), in: Circle())
    }

    private func resetDraft() {
        draft = text
    }

    private func send() {
        guard canSend else { return }
        inputFocus.wrappedValue = false
        onSend(outgoingText)
    }
}

private extension View {
    func secondaryActionStyle() -> some View {
        font(.headline)
            .foregroundStyle(.black)
            .lineLimit(1)
            .minimumScaleFactor(0.85)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(.black.opacity(0.12), in: Capsule())
    }
}

/// The source photo clipped to the selected text, shown on the card so the user can compare
/// the pixels with the extracted value before sending or editing it.
private struct OcrSnippetView: View {
    let image: UIImage

    var body: some View {
        Image(uiImage: image)
            .resizable()
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(.black.opacity(0.12), lineWidth: 1)
            }
            .frame(maxHeight: 96)
            .frame(maxWidth: .infinity)
            .accessibilityLabel("Photo of the selected text")
    }
}

/// TestFlight-only flag control. It sits in the card header beside Close, as an icon, so it
/// never crowds the Edit and Raw/Cleaned actions; the "Flagged" toast confirms the result.
private struct OcrFlagButton: View {
    let state: OcrFlagState
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if state == .sending {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.orange)
                } else {
                    Image(systemName: systemImage)
                        .font(.system(size: 15, weight: .bold))
                }
            }
            .foregroundStyle(state == .failed ? Color.red : Color.orange)
            .frame(width: 34, height: 34)
            .background((state == .failed ? Color.red : Color.orange).opacity(0.16), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(state == .sending)
        .allowsHitTesting(state != .sent)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Saves this photo and its OCR text so parsing can be improved.")
    }

    private var systemImage: String {
        switch state {
        case .idle, .sending: "flag"
        case .sent: "flag.fill"
        case .failed: "arrow.clockwise"
        }
    }

    private var accessibilityLabel: String {
        switch state {
        case .idle: "Flag OCR result"
        case .sending: "Flagging OCR result"
        case .sent: "OCR result flagged"
        case .failed: "Retry flagging OCR result"
        }
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
