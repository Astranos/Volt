import SwiftUI

struct ExtractedTextActionCard: View {
    let text: String
    let isCleaning: Bool
    let onCleanup: () -> Void
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
                Button(action: onCleanup) {
                    Label(isCleaning ? "Cleaning..." : "Cleanup", systemImage: "wand.and.sparkles")
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
