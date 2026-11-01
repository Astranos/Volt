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

/// A `ScanResult` in history, rendered with the shared `HistoryCaptureRow`.
struct CapturedResultRow: View {
    let result: ScanResult
    let canResend: Bool
    let onResend: () -> Void
    var onDelete: (() -> Void)?

    var body: some View {
        HistoryCaptureRow(
            classification: classification,
            copyText: result.value,
            capturedAt: result.capturedAt,
            status: status,
            statusDescription: result.deliveryState.label,
            sendTitle: sendTitle,
            canSend: canResend,
            onSend: onResend,
            onDelete: onDelete
        ) {
            if result.kind == .photo, let imageData = result.imageData, let image = UIImage(data: imageData) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 40, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            } else {
                HistoryCaptureIcon(symbol: classification.symbol, color: iconColor)
            }
        }
    }

    private var classification: HistoryCaptureClassification {
        let kind: HistoryCaptureClassification.Kind = switch result.kind {
        case .text: .text
        case .barcode: .barcode
        case .photo: .photo
        case .dictation: .dictation
        }
        let value = result.kind == .photo && result.imageData == nil ? "Photo preview unavailable" : result.value
        return HistoryCaptureClassification(kind: kind, value: value, format: result.format)
    }

    private var status: HistoryCaptureStatus {
        switch result.deliveryState {
        case .sent: .sent
        case .sending: .sending
        case .failed: .failed
        case .saved: .unsent
        }
    }

    private var sendTitle: String {
        switch result.kind {
        case .barcode, .text:
            result.deliveryState == .failed ? "Retry sending" : "Send to computer"
        case .photo, .dictation:
            "Resend"
        }
    }

    private var iconColor: Color {
        switch result.kind {
        case .barcode, .text: .green
        case .photo: .purple
        case .dictation: .orange
        }
    }
}
