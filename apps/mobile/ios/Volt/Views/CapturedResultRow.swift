import SwiftUI

extension ScanResult {
    var galleryPhoto: GalleryPhoto {
        let result = self
        let status: HistoryCaptureStatus = switch deliveryState {
        case .sent: .sent
        case .sending: .sending
        case .failed: .failed
        case .saved: .unsent
        }
        return GalleryPhoto(id: id, capturedAt: capturedAt, status: status, isStored: hasPhoto) {
            result.loadPhotoData().flatMap(UIImage.init(data:))
        }
    }
}

/// A contiguous photo run in a history session, shown with the shared strip and viewer.
struct CaptureHistoryPhotoBatch: View {
    let batch: PhotoBatch
    let onResend: (ScanResult) -> Void
    let onDelete: (ScanResult) -> Void

    var body: some View {
        HistoryPhotoStrip(
            title: batch.title,
            photos: batch.results.map(\.galleryPhoto),
            onSend: { photo in result(for: photo).map(onResend) },
            onDelete: { photo in result(for: photo).map(onDelete) },
            onDeleteAll: { batch.results.forEach(onDelete) }
        )
    }

    private func result(for photo: GalleryPhoto) -> ScanResult? {
        batch.results.first { $0.id == photo.id }
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
            if result.kind == .photo, result.hasPhoto {
                GalleryPhotoImage(photo: result.galleryPhoto, maxPixelSize: 120)
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
        let value = result.kind == .photo && !result.hasPhoto ? "Photo preview unavailable" : result.value
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
