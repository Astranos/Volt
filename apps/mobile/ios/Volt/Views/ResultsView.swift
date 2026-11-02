import PhotosUI
import SwiftUI

/// Runs photo-library imports picked from the home bar's Photos button and shows progress
/// above `content` only while an import is happening. It wraps content (rather than sitting
/// beside it) so the selection observer stays alive when no banner is shown.
struct PhotoLibraryUploadSection<Content: View>: View {
    @Environment(ScannerStore.self) private var store
    @Binding var selectedItems: [PhotosPickerItem]
    @ViewBuilder let content: () -> Content
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
        let banner = PhotoImportStatusBanner(
            isPreparing: isPreparingUploads,
            prepared: selectedUploadPrepared,
            total: selectedUploadTotal,
            progress: activeUploadProgress,
            message: statusMessage,
            isError: uploadError != nil
        )
        VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
            if banner.isVisible { banner }
            content()
        }
        .onChange(of: selectedItems) { _, newItems in
            guard !newItems.isEmpty else { return }
            selectedItems = []
            enqueueUploadSelection(newItems)
        }
    }

    private var statusMessage: String? {
        if let uploadError { return uploadError }
        guard queuedUploadPhotoCount > 0 else { return nil }
        return "\(queuedUploadPhotoCount) more photo\(queuedUploadPhotoCount == 1 ? "" : "s") queued."
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
