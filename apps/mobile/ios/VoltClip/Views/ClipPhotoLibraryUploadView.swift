@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ClipPhotoLibraryUploadSection: View {
    @Bindable var store: ClipScannerStore
    @State private var pickerItems: [PhotosPickerItem] = []
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
                selectedItems: $pickerItems,
                isConnected: store.isConnected,
                isPreparing: isPreparingUploads,
                isConnecting: store.isPairing,
                isUploading: activeUploadProgress != nil,
                statusText: uploadStatusText,
                showsError: uploadError != nil,
                disabledHint: store.targetHint
            )
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            pickerItems = []
            enqueueUploadSelection(items)
        }
        .onChange(of: store.isConnected) { _, isConnected in
            if isConnected {
                startUploadQueueIfNeeded()
            }
        }
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
        } else if store.isPairing {
            status = store.statusText
        } else if store.isConnected {
            status = "Ready to upload to Chrome"
        } else {
            status = store.targetHint
        }

        guard queuedUploadPhotoCount > 0 else { return status }
        return "\(status) \(queuedUploadPhotoCount) more photo\(queuedUploadPhotoCount == 1 ? "" : "s") queued."
    }

    private var selectedUploadReadCount: Int {
        guard selectedUploadTotal > 0 else { return 0 }
        return min(max(selectedUploadPrepared, 1), selectedUploadTotal)
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
        guard store.isConnected,
              !queuedUploadSelections.isEmpty,
              !isProcessingUploadQueue
        else { return }
        isProcessingUploadQueue = true
        Task { await processQueuedUploads() }
    }

    private func processQueuedUploads() async {
        while store.isConnected, !queuedUploadSelections.isEmpty {
            let items = queuedUploadSelections.removeFirst()
            await uploadSelectedItems(items)
        }
        isProcessingUploadQueue = false
    }
}
