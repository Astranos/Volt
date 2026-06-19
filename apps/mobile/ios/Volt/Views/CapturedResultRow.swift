import SwiftUI

struct CapturedResultRow: View {
    let result: ScanResult
    let canResend: Bool
    let onResend: () -> Void
    var onDelete: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            preview

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Spacer(minLength: 0)
                }

                resultContent

                HStack(spacing: 8) {
                    Label(result.format, systemImage: "info.circle")
                    Text(result.capturedAt, format: .dateTime.hour().minute())
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            VStack(spacing: 6) {
                Button(action: onResend) {
                    Label("Resend \(title) to Chrome", systemImage: result.deliveryState == .sending ? "hourglass" : "paperplane")
                        .labelStyle(.iconOnly)
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless)
                .disabled(!canResend || result.deliveryState == .sending)

                if let onDelete {
                    Button(role: .destructive, action: onDelete) {
                        Label("Delete \(title)", systemImage: "trash")
                            .labelStyle(.iconOnly)
                            .font(.system(size: 16, weight: .semibold))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.borderless)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button(action: onResend) {
                Label("Resend", systemImage: "paperplane")
            }
            .tint(.green)
            .disabled(!canResend || result.deliveryState == .sending)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if let onDelete {
                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }

    @ViewBuilder
    private var preview: some View {
        if result.kind == .photo, let imageData = result.imageData, UIImage(data: imageData) != nil {
            EmptyView()
        } else {
            Image(systemName: symbol)
                .font(.title3.weight(.semibold))
                .foregroundStyle(iconColor)
                .frame(width: 44, height: 44)
                .background(iconColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    @ViewBuilder
    private var resultContent: some View {
        if result.kind == .photo, let imageData = result.imageData, let image = UIImage(data: imageData) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(maxWidth: 180)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(.quaternary, lineWidth: 1)
                }
        } else {
            Text(primaryText)
                .font(result.kind == .barcode ? .callout.monospaced() : .callout)
                .foregroundStyle(.primary)
                .lineLimit(4)
                .textSelection(.enabled)
        }
    }

    private var primaryText: String {
        switch result.kind {
        case .photo:
            result.imageData == nil ? "Photo preview unavailable" : result.value
        default:
            result.value
        }
    }

    private var title: String {
        switch result.kind {
        case .barcode: "Barcode"
        case .text: "Document Text"
        case .photo: "Photo"
        case .dictation: "Dictation"
        }
    }

    private var iconColor: Color {
        switch result.kind {
        case .barcode: .green
        case .text: .green
        case .photo: .purple
        case .dictation: .orange
        }
    }

    private var symbol: String {
        switch result.kind {
        case .barcode: "barcode"
        case .text: "doc.text"
        case .photo: "photo"
        case .dictation: "mic"
        }
    }

}
