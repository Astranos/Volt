import PhotosUI
import SwiftUI

struct UploadView: View {
    @Environment(ScannerStore.self) private var store
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var isPreparingUploads = false
    @State private var uploadError: String?
    @State private var expandedBatchIds: Set<String> = []

    private var recentPhotoResults: [ScanResult] {
        store.results.filter { $0.kind == .photo && $0.source == .upload }
    }

    private var recentUploadBatches: [PhotoUploadBatch] {
        let grouped = Dictionary(grouping: recentPhotoResults) { result in
            result.batchId ?? result.id.uuidString
        }

        return grouped.map { key, results in
            PhotoUploadBatch(id: key, results: results.sorted { $0.capturedAt < $1.capturedAt })
        }
        .sorted { $0.latestCapturedAt > $1.latestCapturedAt }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    uploadButton
                    statusPanel
                    recentUploads
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Upload")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ScannerConnectionToolbar()
            }
            .onChange(of: selectedItems) { _, newItems in
                guard !newItems.isEmpty else { return }
                Task {
                    await uploadSelectedItems(newItems)
                    selectedItems = []
                }
            }
        }
    }

    private var uploadButton: some View {
        let isConnected = store.connectionStatus.isConnected
        let isPreparing = isPreparingUploads

        return PhotosPicker(
            selection: $selectedItems,
            maxSelectionCount: 30,
            matching: .images
        ) {
            HStack(spacing: 14) {
                Image(systemName: isPreparing ? "hourglass" : "photo.on.rectangle.angled")
                    .font(.system(size: 28, weight: .semibold))
                    .frame(width: 54, height: 54)
                    .background(.white.opacity(0.18), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(isPreparing ? "Preparing uploads" : "Choose Photos")
                        .font(.title3.weight(.bold))
                    Text("Select photos from your library and send them to Chrome.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.78))
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.headline.weight(.semibold))
            }
            .foregroundStyle(.white)
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(isConnected ? .green : .gray, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .opacity(isPreparing ? 0.68 : 1)
        }
        .buttonStyle(.plain)
        .disabled(!isConnected || isPreparing)
    }

    private var statusPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(store.connectionStatus.isConnected ? "Ready to upload" : "Upload unavailable", systemImage: store.connectionStatus.isConnected ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .font(.headline)
                .foregroundStyle(store.connectionStatus.isConnected ? .green : .orange)

            Text(uploadError ?? store.targetHint)
                .font(.subheadline)
                .foregroundStyle(uploadError == nil ? Color.secondary : Color.red)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var recentUploads: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recent Uploads")
                    .font(.headline)
                Spacer()
                Text("\(recentPhotoResults.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if recentUploadBatches.isEmpty {
                ContentUnavailableView(
                    "No Uploads Yet",
                    systemImage: "photo.badge.plus",
                    description: Text("Camera roll uploads will appear here after they are sent.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 34)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                VStack(spacing: 10) {
                    ForEach(recentUploadBatches) { batch in
                        PhotoUploadBatchCard(
                            batch: batch,
                            isExpanded: expandedBatchIds.contains(batch.id),
                            onToggleExpanded: {
                                if expandedBatchIds.contains(batch.id) {
                                    expandedBatchIds.remove(batch.id)
                                } else {
                                    expandedBatchIds.insert(batch.id)
                                }
                            },
                            onDelete: {
                                batch.results.forEach { store.removeResult(id: $0.id) }
                                expandedBatchIds.remove(batch.id)
                            },
                            onDeletePhoto: { result in
                                store.removeResult(id: result.id)
                            }
                        )
                        .padding(14)
                        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                }
            }
        }
    }

    private func uploadSelectedItems(_ items: [PhotosPickerItem]) async {
        isPreparingUploads = true
        uploadError = nil
        defer { isPreparingUploads = false }

        var images: [UIImage] = []
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data)
            else {
                continue
            }
            images.append(image)
        }

        guard !images.isEmpty else {
            uploadError = "Could not read any selected photos."
            return
        }

        await store.uploadPhotos(images)
    }
}

private struct PhotoUploadBatch: Identifiable {
    let id: String
    let results: [ScanResult]

    var latestCapturedAt: Date {
        results.map(\.capturedAt).max() ?? .distantPast
    }

    var deliveryState: ScanResult.DeliveryState {
        if results.contains(where: { $0.deliveryState == .failed }) {
            return .failed
        }
        if results.contains(where: { $0.deliveryState == .sending }) {
            return .sending
        }
        if results.allSatisfy({ $0.deliveryState == .sent }) {
            return .sent
        }
        return .saved
    }
}

private struct PhotoUploadBatchCard: View {
    let batch: PhotoUploadBatch
    let isExpanded: Bool
    let onToggleExpanded: () -> Void
    let onDelete: () -> Void
    let onDeletePhoto: (ScanResult) -> Void

    private var visibleResults: [ScanResult] {
        isExpanded ? batch.results : Array(batch.results.prefix(4))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Uploaded \(batch.results.count) photo\(batch.results.count == 1 ? "" : "s")")
                        .font(.headline)
                    Text(batch.latestCapturedAt, format: .dateTime.hour().minute())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                UploadDeliveryBadge(state: batch.deliveryState)

                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Delete upload batch")
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 86), spacing: 8)], spacing: 8) {
                ForEach(visibleResults) { result in
                    PhotoUploadThumbnail(result: result, onDelete: {
                        onDeletePhoto(result)
                    })
                }
            }

            if batch.results.count > 4 {
                Button(action: onToggleExpanded) {
                    Label(
                        isExpanded ? "Show fewer photos" : "View all \(batch.results.count) photos",
                        systemImage: isExpanded ? "chevron.up" : "photo.stack"
                    )
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)
            }
        }
    }
}

private struct PhotoUploadThumbnail: View {
    let result: ScanResult
    let onDelete: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if let imageData = result.imageData, let image = UIImage(data: imageData) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "photo")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.secondary.opacity(0.12))
            }

            Button(role: .destructive, action: onDelete) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title3)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.5))
            }
            .buttonStyle(.plain)
            .padding(5)
            .accessibilityLabel("Remove photo")
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.quaternary, lineWidth: 1)
        }
    }
}

private struct UploadDeliveryBadge: View {
    let state: ScanResult.DeliveryState

    var body: some View {
        Label(state.label, systemImage: symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color.opacity(0.12), in: Capsule())
            .lineLimit(1)
    }

    private var symbol: String {
        switch state {
        case .saved: "tray"
        case .sending: "paperplane"
        case .sent: "checkmark.circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        }
    }

    private var color: Color {
        switch state {
        case .saved: .secondary
        case .sending: .green
        case .sent: .green
        case .failed: .red
        }
    }
}
