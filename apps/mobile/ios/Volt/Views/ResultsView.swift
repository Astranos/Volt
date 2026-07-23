import PhotosUI
import SwiftUI

struct UploadView: View {
    @Environment(ScannerStore.self) private var store
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var isPreparingUploads = false
    @State private var selectedUploadTotal = 0
    @State private var selectedUploadPrepared = 0
    @State private var uploadError: String?
    @State private var queuedUploadSelections: [[PhotosPickerItem]] = []
    @State private var isProcessingUploadQueue = false
    @State private var expandedBatchIds: Set<String> = []
    @State private var isSessionsPresented = false

    private var recentPhotoResults: [ScanResult] {
        store.results.filter { $0.kind == .photo && $0.source == .upload }
    }

    private var recentUploadBatches: [PhotoUploadBatch] {
        let grouped = Dictionary(grouping: recentPhotoResults) { result in
            result.batchId ?? result.id.uuidString
        }

        return grouped.map { key, results in
            let progress = store.photoUploadProgress?.id == key ? store.photoUploadProgress : nil
            return PhotoUploadBatch(
                id: key,
                results: results.sorted { $0.capturedAt < $1.capturedAt },
                expectedTotal: progress?.total ?? results.count,
                isActive: progress?.isActive == true
            )
        }
        .sorted { $0.latestCapturedAt > $1.latestCapturedAt }
    }

    private var activeUploadProgress: PhotoUploadProgress? {
        guard let progress = store.photoUploadProgress, progress.isActive else { return nil }
        return progress
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ScannerSectionHeader(
                        title: "Upload",
                        onConnectionControlTapped: {
                            isSessionsPresented = true
                        }
                    )

                    if isPreparingUploads {
                        PhotoPreparationProgressSummary(
                            prepared: selectedUploadPrepared,
                            total: selectedUploadTotal
                        )
                    } else if let progress = activeUploadProgress {
                        PhotoUploadProgressSummary(progress: progress)
                    }

                    recentUploads
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Upload")
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $isSessionsPresented) {
                PairingSessionsView()
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .onChange(of: selectedItems) { _, newItems in
                guard !newItems.isEmpty else { return }
                selectedItems = []
                enqueueUploadSelection(newItems)
            }
            .onAppear {
                store.selectedSection = .upload
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ScannerPhotoPickerAccessory(
                    selectedItems: $selectedItems,
                    isConnected: true,
                    isPreparing: isPreparingUploads,
                    isUploading: activeUploadProgress != nil,
                    statusText: uploadStatusText,
                    showsError: uploadError != nil,
                    disabledHint: uploadError ?? store.targetHint
                )
            }
        }
    }

    private var selectedUploadReadCount: Int {
        guard selectedUploadTotal > 0 else { return 0 }
        return min(max(selectedUploadPrepared, 1), selectedUploadTotal)
    }

    private var uploadStatusText: String {
        let status: String
        if let uploadError {
            status = uploadError
        } else if isPreparingUploads {
            if selectedUploadTotal > 0 {
                status = "Reading \(selectedUploadReadCount) of \(selectedUploadTotal) selected photos"
            } else {
                status = "Preparing uploads..."
            }
        } else if let progress = activeUploadProgress {
            status = "\(progress.title). \(progress.detail)."
        } else {
            status = "Selected photos save locally and sync to your Volt workspace when signed in."
        }

        guard queuedUploadPhotoCount > 0 else { return status }
        return "\(status) \(queuedUploadPhotoCount) more photo\(queuedUploadPhotoCount == 1 ? "" : "s") queued."
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
        selectedUploadTotal = items.count
        selectedUploadPrepared = 0
        isPreparingUploads = true
        uploadError = nil

        var images: [UIImage] = []
        for (index, item) in items.enumerated() {
            if let data = try? await item.loadTransferable(type: Data.self),
               let image = UIImage(data: data) {
                images.append(image)
            }
            selectedUploadPrepared = index + 1
        }

        isPreparingUploads = false
        selectedUploadTotal = 0
        selectedUploadPrepared = 0

        guard !images.isEmpty else {
            uploadError = "Could not read any selected photos."
            return
        }

        await store.uploadPhotos(images)
    }

    private var queuedUploadPhotoCount: Int {
        queuedUploadSelections.reduce(0) { count, selection in
            count + selection.count
        }
    }

    private func enqueueUploadSelection(_ items: [PhotosPickerItem]) {
        queuedUploadSelections.append(items)
        startUploadQueueIfNeeded()
    }

    private func startUploadQueueIfNeeded() {
        guard !queuedUploadSelections.isEmpty,
              !isProcessingUploadQueue
        else { return }
        isProcessingUploadQueue = true
        Task { await processQueuedUploads() }
    }

    private func processQueuedUploads() async {
        while !queuedUploadSelections.isEmpty {
            let items = queuedUploadSelections.removeFirst()
            await uploadSelectedItems(items)
        }
        isProcessingUploadQueue = false
    }
}

private struct PhotoUploadBatch: Identifiable {
    let id: String
    let results: [ScanResult]
    let expectedTotal: Int
    let isActive: Bool

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

    var title: String {
        if isActive {
            return "Uploading \(results.count) of \(expectedTotal) photo\(expectedTotal == 1 ? "" : "s")"
        }
        return "Uploaded \(results.count) photo\(results.count == 1 ? "" : "s")"
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
                    Text(batch.title)
                        .font(.headline)
                    Text(batch.latestCapturedAt, format: .dateTime.hour().minute())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                DeliveryBadge(state: batch.deliveryState)

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
        GeometryReader { proxy in
            ZStack(alignment: .topTrailing) {
                if let imageData = result.imageData, let image = UIImage(data: imageData) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .clipped()
                } else {
                    Image(systemName: "photo")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: proxy.size.width, height: proxy.size.height)
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
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.quaternary, lineWidth: 1)
        }
    }
}

struct DeliveryBadge: View {
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
