import PhotosUI
import SwiftUI

struct PhotoLibraryUploadSection: View {
    @Environment(ScannerStore.self) private var store
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var isPreparingUploads = false
    @State private var selectedUploadTotal = 0
    @State private var selectedUploadPrepared = 0
    @State private var uploadError: String?
    @State private var queuedUploadSelections: [[PhotosPickerItem]] = []
    @State private var isProcessingUploadQueue = false

    private var activeUploadProgress: PhotoUploadProgress? {
        guard let progress = store.photoUploadProgress, progress.isActive else { return nil }
        return progress
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("From Photo Library")
                .font(.headline)

            if isPreparingUploads {
                PhotoPreparationProgressSummary(
                    prepared: selectedUploadPrepared,
                    total: selectedUploadTotal
                )
            } else if let progress = activeUploadProgress {
                PhotoUploadProgressSummary(progress: progress)
            }

            ScannerPhotoPickerAccessory(
                selectedItems: $selectedItems,
                isConnected: true,
                isPreparing: isPreparingUploads,
                isUploading: activeUploadProgress != nil,
                statusText: uploadStatusText,
                showsError: uploadError != nil,
                disabledHint: uploadError ?? "Photos save on this iPhone before cloud sync."
            )
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .onChange(of: selectedItems) { _, newItems in
            guard !newItems.isEmpty else { return }
            selectedItems = []
            enqueueUploadSelection(newItems)
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
