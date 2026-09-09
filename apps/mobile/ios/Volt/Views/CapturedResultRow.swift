import SwiftUI

/// A bounded preview of a contiguous photo run, with an inline lazy gallery.
struct CaptureHistoryPhotoBatch: View {
    let batch: PhotoBatch
    let onResend: (ScanResult) -> Void
    let onDelete: (ScanResult) -> Void
    @State private var isExpanded = false
    @State private var previewedPhoto: ScanResult?

    private var visibleResults: [ScanResult] {
        isExpanded ? batch.results : Array(batch.results.suffix(4))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(batch.title, systemImage: "photo.stack")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                DeliveryBadge(state: batch.deliveryState)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96, maximum: 112), spacing: 8)], spacing: 8) {
                ForEach(visibleResults) { result in
                    VStack(spacing: 4) {
                        Button { previewedPhoto = result } label: {
                            GeometryReader { proxy in
                                Group {
                                    if let data = result.imageData, let image = UIImage(data: data) {
                                        Image(uiImage: image).resizable().scaledToFill()
                                    } else {
                                        Image(systemName: "photo").frame(maxWidth: .infinity, maxHeight: .infinity)
                                    }
                                }
                                .frame(width: proxy.size.width, height: proxy.size.height)
                                .clipped()
                            }
                            .aspectRatio(1, contentMode: .fit)
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Preview photo from \(result.capturedAt.formatted(date: .omitted, time: .shortened))")
                        HStack(spacing: 0) {
                            Button { onResend(result) } label: {
                                Label("Resend photo", systemImage: "paperplane").labelStyle(.iconOnly)
                                    .frame(minWidth: 44, minHeight: 44)
                            }
                            Button(role: .destructive) { onDelete(result) } label: {
                                Label("Delete photo", systemImage: "trash").labelStyle(.iconOnly)
                                    .frame(minWidth: 44, minHeight: 44)
                            }
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
            if batch.results.count > 4 {
                Button(isExpanded ? "Show fewer photos" : "View all \(batch.results.count) photos") {
                    isExpanded.toggle()
                }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.bordered)
            }
        }
        .sheet(item: $previewedPhoto) { result in
            CaptureHistoryPhotoPreview(result: result, onResend: { onResend(result) }, onDelete: { onDelete(result) })
        }
    }
}

private struct CaptureHistoryPhotoPreview: View {
    let result: ScanResult
    let onResend: () -> Void
    let onDelete: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let data = result.imageData, let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFit()
                } else {
                    ContentUnavailableView("Photo preview unavailable", systemImage: "photo")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("Resend", systemImage: "paperplane", action: onResend)
                    Spacer()
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        onDelete()
                        dismiss()
                    }
                }
            }
        }
    }
}

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
                    Label(actionLabel, systemImage: result.deliveryState == .sending ? "hourglass" : "paperplane")
                        .labelStyle(.iconOnly)
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless)
                .disabled(!canResend)

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
                Label(result.kind == .barcode || result.kind == .text ? "Insert" : "Resend", systemImage: "paperplane")
            }
            .tint(.green)
            .disabled(!canResend)
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

    private var actionLabel: String {
        switch result.kind {
        case .barcode, .text:
            "Insert \(title) into selected computer"
        case .photo, .dictation:
            "Resend \(title)"
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
