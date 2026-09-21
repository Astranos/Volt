@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ClipUnifiedHistoryView: View {
    @Bindable var store: ClipScannerStore
    let onContinue: (String) -> Void
    @State private var previewedPhoto: ClipScannerStore.ClipPhoto?

    private var sessionIDs: [String] {
        let ids = Set(store.captures.map(\.batchId) + store.photos.map { $0.batchId ?? $0.id.uuidString.lowercased() })
        return ids.sorted { lhs, rhs in
            latestDate(for: lhs) > latestDate(for: rhs)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
            Text("History").font(.title2.bold())
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
                ForEach(sessionIDs, id: \.self) { id in
                    sessionCard(id: id)
                }
            }
        }
        .sheet(item: $previewedPhoto) { photo in
            ClipPhotoPreviewSheet(photo: photo) {
                store.removePhoto(id: photo.id)
                previewedPhoto = nil
            }
        }
    }

    private func sessionCard(id: String) -> some View {
        let captures = store.captures.filter { $0.batchId == id }.sorted { $0.capturedAt < $1.capturedAt }
        let photos = store.photos.filter { ($0.batchId ?? $0.id.uuidString.lowercased()) == id }.sorted { $0.capturedAt < $1.capturedAt }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(captures.count + photos.count) capture\(captures.count + photos.count == 1 ? "" : "s")")
                        .font(.headline)
                    Text("\(captures.map { $0.mode.title }.uniqued().joined(separator: " · "))\(captures.isEmpty || photos.isEmpty ? "" : " · ")\(photos.isEmpty ? "" : "Photos")")
                        .font(.caption).foregroundStyle(.secondary)
                    Text(latestDate(for: id), format: .dateTime.hour().minute())
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
            }
            Button("Continue session", systemImage: "camera.fill") {
                onContinue(id)
            }
            .font(.subheadline.weight(.semibold))
            .buttonStyle(.borderedProminent)
            .tint(.accentColor)
            Button("Delete session", systemImage: "trash", role: .destructive) {
                store.removeSession(batchId: id)
            }
            .font(.subheadline.weight(.semibold))
            ForEach(captures) { capture in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: capture.mode.symbolName)
                        .foregroundStyle(.green)
                        .frame(width: 32, height: 32)
                        .background(.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(capture.value).lineLimit(4).textSelection(.enabled)
                        Text(capture.status).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .padding(12)
                .background(.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            if !photos.isEmpty {
                ClipPhotoBatchCard(
                    batch: ClipPhotoBatch(
                        id: id,
                        photos: photos,
                        expectedTotal: store.photoUploadProgress?.id == id ? store.photoUploadProgress?.total ?? photos.count : photos.count,
                        isActive: store.photoUploadProgress?.id == id && store.photoUploadProgress?.isActive == true
                    ),
                    canAddPhotos: true,
                    onAddPhotos: { onContinue(id) },
                    onPreview: { previewedPhoto = $0 },
                    onDeletePhoto: { store.removePhoto(id: $0.id) },
                    onDeleteBatch: { store.removePhotos(batchId: id) }
                )
            }
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func latestDate(for id: String) -> Date {
        let captureDate = store.captures.filter { $0.batchId == id }.map(\.capturedAt).max() ?? .distantPast
        let photoDate = store.photos.filter { ($0.batchId ?? $0.id.uuidString.lowercased()) == id }.map(\.capturedAt).max() ?? .distantPast
        return max(captureDate, photoDate)
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

struct ClipPhotoBatch: Identifiable, Equatable {
    let id: String
    let photos: [ClipScannerStore.ClipPhoto]
    let expectedTotal: Int
    let isActive: Bool

    var source: ClipScannerStore.ClipPhoto.Source {
        photos.first?.source ?? .capture
    }

    var latestCapturedAt: Date {
        photos.map(\.capturedAt).max() ?? .distantPast
    }

    var title: String {
        if source == .upload && isActive {
            return "Uploading \(photos.count) of \(expectedTotal) photo\(expectedTotal == 1 ? "" : "s")"
        }
        let action = source == .upload ? "uploaded" : "captured"
        return "\(photos.count) \(action) photo\(photos.count == 1 ? "" : "s")"
    }

    var statusText: String {
        if photos.contains(where: { $0.status == "Failed" }) {
            return "Some failed"
        }
        if photos.contains(where: { $0.status == "Sending" }) {
            return "Sending"
        }
        if photos.allSatisfy({ $0.status == "Delivered" }) {
            return "Delivered"
        }
        return "Saved"
    }
}

struct ClipPhotoBatchCard: View {
    let batch: ClipPhotoBatch
    let canAddPhotos: Bool
    let onAddPhotos: () -> Void
    let onPreview: (ClipScannerStore.ClipPhoto) -> Void
    let onDeletePhoto: (ClipScannerStore.ClipPhoto) -> Void
    let onDeleteBatch: () -> Void

    private var visiblePhotos: [ClipScannerStore.ClipPhoto] {
        Array(batch.photos.suffix(4))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(batch.title)
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    Text(batch.latestCapturedAt, format: .dateTime.hour().minute())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                Text(batch.statusText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 9)
                    .frame(minHeight: 26)
                    .background(.secondary.opacity(0.12), in: Capsule())

                Button(role: .destructive, action: onDeleteBatch) {
                    Image(systemName: "trash")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Delete \(batch.title)")
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 86), spacing: 8)], spacing: 8) {
                ForEach(visiblePhotos) { photo in
                    ClipPhotoThumbnail(
                        photo: photo,
                        onPreview: {
                            onPreview(photo)
                        },
                        onDelete: {
                            onDeletePhoto(photo)
                        }
                    )
                }
            }

            if batch.source == .capture {
                Button(action: onAddPhotos) {
                    Label("Add Photos", systemImage: "plus.viewfinder")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canAddPhotos)
                .accessibilityLabel("Add photos to \(batch.title) from \(batch.latestCapturedAt.formatted(date: .abbreviated, time: .shortened))")
            }

            if batch.photos.count > 4 {
                NavigationLink {
                    ClipPhotoBatchGallery(batch: batch, onDelete: onDeletePhoto)
                } label: {
                    Label("View all \(batch.photos.count) photos", systemImage: "photo.stack")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct ClipPhotoThumbnail: View {
    let photo: ClipScannerStore.ClipPhoto
    let onPreview: () -> Void
    let onDelete: () -> Void

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topTrailing) {
                Button(action: onPreview) {
                    Image(uiImage: photo.image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .clipped()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Preview photo")

                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.5))
                }
                .buttonStyle(.plain)
                .padding(5)
                .accessibilityLabel("Delete photo")
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct ClipPhotoBatchGallery: View {
    @State private var previewedPhoto: ClipScannerStore.ClipPhoto?

    let batch: ClipPhotoBatch
    let onDelete: (ClipScannerStore.ClipPhoto) -> Void

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 8)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(batch.photos) { photo in
                    ClipPhotoThumbnail(
                        photo: photo,
                        onPreview: { previewedPhoto = photo },
                        onDelete: { delete(photo) }
                    )
                }
            }
            .padding()
        }
        .background(ScannerTabLayout.background)
        .navigationTitle(batch.title.capitalized)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $previewedPhoto) { photo in
            ClipPhotoPreviewSheet(photo: photo) {
                delete(photo)
                previewedPhoto = nil
            }
        }
    }

    private func delete(_ photo: ClipScannerStore.ClipPhoto) {
        onDelete(photo)
    }
}

struct ClipPhotoPreviewSheet: View {
    let photo: ClipScannerStore.ClipPhoto
    let onDelete: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                Image(uiImage: photo.image)
                    .resizable()
                    .scaledToFit()
                    .padding()
            }
            .navigationTitle(Text(photo.capturedAt, format: .dateTime.hour().minute()))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .destructive, action: onDelete) {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
    }
}

private func clipConnectionTitle(
    isConnected: Bool,
    isPairing: Bool,
    pairingLabel: String?,
    pairingFailureMessage: String?
) -> String {
    if isConnected {
        return pairingLabel ?? "Chrome"
    }
    if isPairing {
        return "Connecting"
    }
    if pairingFailureMessage != nil {
        return "Failed"
    }
    return "Connect"
}
