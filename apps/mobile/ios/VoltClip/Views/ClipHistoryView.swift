@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ClipUnifiedHistoryView: View {
    @Bindable var store: ClipScannerStore
    let onContinue: (String) -> Void

    private var sessionIDs: [String] {
        let ids = Set(store.captures.map(\.batchId) + store.photos.map { $0.batchId ?? $0.id.uuidString.lowercased() })
        return ids.sorted { lhs, rhs in
            latestDate(for: lhs) > latestDate(for: rhs)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if sessionIDs.isEmpty {
                ContentUnavailableView(
                    "No Scans Yet",
                    systemImage: "camera.viewfinder",
                    description: Text("Text, barcodes, photos, and audio from each camera session appear here.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 34)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                ForEach(historyDaySections(sessionIDs, date: latestDate(for:)), id: \.title) { section in
                    HistoryDayHeader(title: section.title)
                    ForEach(section.items, id: \.self) { id in
                        sessionCard(id: id)
                    }
                }
            }
        }
    }

    private func sessionCard(id: String) -> some View {
        let captures = store.captures.filter { $0.batchId == id }.sorted { $0.capturedAt < $1.capturedAt }
        let photos = store.photos.filter { ($0.batchId ?? $0.id.uuidString.lowercased()) == id }.sorted { $0.capturedAt < $1.capturedAt }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(captures.count + photos.count) capture\(captures.count + photos.count == 1 ? "" : "s")")
                    .font(.headline)
                Spacer()
                Menu {
                    Button("Delete session", systemImage: "trash", role: .destructive) {
                        store.removeSession(batchId: id)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 32, height: 28)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Session options")
            }
            HStack(alignment: .center, spacing: 8) {
                Text("\(sessionSummary(captures: captures, photos: photos)) · \(latestDate(for: id).formatted(date: .omitted, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                // Secondary to the bar's Start button, so tinted rather than filled.
                Button("Continue", systemImage: "camera.fill") {
                    onContinue(id)
                }
                .font(.subheadline.weight(.semibold))
                .accessibilityLabel("Continue session")
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(.green)
            }
            if !captures.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(captures.enumerated()), id: \.element.id) { index, capture in
                        if index > 0 {
                            Divider().padding(.leading, 64)
                        }
                        ClipCaptureHistoryRow(
                            capture: capture,
                            isConnected: store.isConnected,
                            onSend: { store.resendCapture(id: capture.id) },
                            onDelete: { store.removeCapture(id: capture.id) }
                        )
                    }
                }
                .background(Color(.tertiarySystemGroupedBackground).opacity(0.6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            if !photos.isEmpty {
                let isUploading = store.photoUploadProgress?.id == id && store.photoUploadProgress?.isActive == true
                let expected = isUploading ? store.photoUploadProgress?.total ?? photos.count : photos.count
                HistoryPhotoStrip(
                    title: "\(photos.count) \(photos.first?.source == .upload ? "uploaded" : "captured") photo\(photos.count == 1 ? "" : "s")",
                    photos: photos.map(\.galleryPhoto),
                    placeholderCount: max(0, expected - photos.count),
                    onSend: { store.resendPhoto(id: $0.id) },
                    onDelete: { store.removePhoto(id: $0.id) },
                    onDeleteAll: { store.removePhotos(batchId: id) }
                )
                .background(Color(.tertiarySystemGroupedBackground).opacity(0.6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func sessionSummary(captures: [ClipScannerStore.ClipCapture], photos: [ClipScannerStore.ClipPhoto]) -> String {
        var modes = captures.map { $0.mode.title }.uniqued()
        if !photos.isEmpty { modes.append("Photos") }
        return modes.joined(separator: " · ")
    }

    private func latestDate(for id: String) -> Date {
        let captureDate = store.captures.filter { $0.batchId == id }.map(\.capturedAt).max() ?? .distantPast
        let photoDate = store.photos.filter { ($0.batchId ?? $0.id.uuidString.lowercased()) == id }.map(\.capturedAt).max() ?? .distantPast
        return max(captureDate, photoDate)
    }
}

extension ClipScannerStore.ClipPhoto {
    var galleryPhoto: GalleryPhoto {
        let image = image
        let status: HistoryCaptureStatus = switch self.status {
        case "Sending": .sending
        case "Failed": .failed
        case "Saved until connected": .unsent
        default: .sent
        }
        return GalleryPhoto(id: id, capturedAt: capturedAt, status: status) { image }
    }
}

/// An App Clip capture rendered with the shared history row.
private struct ClipCaptureHistoryRow: View {
    let capture: ClipScannerStore.ClipCapture
    let isConnected: Bool
    let onSend: () -> Void
    let onDelete: () -> Void

    var body: some View {
        let classification = HistoryCaptureClassification(
            kind: capture.mode == .barcode ? .barcode : capture.mode == .dictation ? .dictation : .text,
            value: capture.value,
            format: capture.format
        )
        HistoryCaptureRow(
            classification: classification,
            copyText: capture.value,
            capturedAt: capture.capturedAt,
            status: status,
            statusDescription: capture.status,
            sendTitle: capture.status == "Failed" ? "Retry sending" : "Send to workspace",
            canSend: isConnected,
            onSend: onSend,
            onDelete: onDelete
        ) {
            HistoryCaptureIcon(symbol: classification.symbol, color: capture.mode == .dictation ? .orange : .green)
        }
    }

    private var status: HistoryCaptureStatus {
        switch capture.status {
        case "Sending": .sending
        case "Failed": .failed
        case "Saved until connected": .unsent
        default: .sent
        }
    }
}

private extension Array where Element == String {
    func uniqued() -> [String] {
        var seen = Set<String>()
        return filter { seen.insert($0).inserted }
    }
}

struct ClipRecentCapturesSection: View {
    let mode: CaptureMode
    let captures: [ClipScannerStore.ClipCapture]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent \(mode.clipActivityNoun)")
                .font(.headline)

            if captures.isEmpty {
                ContentUnavailableView(
                    "No \(mode.clipTabTitle) Yet",
                    systemImage: mode.symbolName,
                    description: Text("Captures from this App Clip session will appear here.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 34)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                VStack(spacing: 10) {
                    ForEach(captures.prefix(5)) { capture in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: mode.symbolName)
                                .font(.headline)
                                .foregroundStyle(.green)
                                .frame(width: 36, height: 36)
                                .background(.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))

                            VStack(alignment: .leading, spacing: 4) {
                                Text(capture.value)
                                    .font(.body)
                                    .lineLimit(3)
                                    .textSelection(.enabled)
                                Text(capture.capturedAt, format: .dateTime.hour().minute())
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Spacer(minLength: 8)
                            ClipPhotoStatusBadge(status: capture.status)
                        }
                        .padding(14)
                        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                }
            }
        }
    }
}

extension CaptureMode {
    var clipTabTitle: String {
        switch self {
        case .ocr, .dictation: "Text"
        case .barcode: "Barcode"
        case .photo: "Photos"
        }
    }

    var clipActivityNoun: String {
        switch self {
        case .ocr, .dictation: "text captures"
        case .barcode: "barcodes"
        case .photo: "photos"
        }
    }

    var clipActionVerb: String {
        switch self {
        case .ocr, .dictation: "scan text"
        case .barcode: "scan a barcode"
        case .photo: "capture photos"
        }
    }

    var clipStartActionTitle: String {
        switch self {
        case .ocr, .dictation: "Scan Text"
        case .barcode: "Scan Barcode"
        case .photo: "Start Photo Session"
        }
    }
}

struct ClipPhotoStatusBadge: View {
    let status: String

    var body: some View {
        Label(status, systemImage: symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color.opacity(0.12), in: Capsule())
            .lineLimit(1)
    }

    private var symbol: String {
        switch status {
        case "Sending":
            return "paperplane"
        case "Delivered":
            return "checkmark.circle.fill"
        case "Some failed", "Failed":
            return "exclamationmark.triangle.fill"
        default:
            return "tray"
        }
    }

    private var color: Color {
        switch status {
        case "Sending", "Delivered":
            return .green
        case "Some failed", "Failed":
            return .red
        default:
            return .secondary
        }
    }
}
