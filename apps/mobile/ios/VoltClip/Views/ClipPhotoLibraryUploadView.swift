@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

/// Runs imports picked from the home bar's Photos button and shows progress above
/// `content` only while there's something to report. Wraps content so the selection
/// observer stays alive when no banner is shown.
struct ClipPhotoLibraryUploadSection<Content: View>: View {
    @Bindable var store: ClipScannerStore
    @Binding var pickerItems: [PhotosPickerItem]
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

    private var statusMessage: String? {
        if let uploadError { return uploadError }
        guard queuedUploadPhotoCount > 0 else { return nil }
        let photos = "\(queuedUploadPhotoCount) photo\(queuedUploadPhotoCount == 1 ? "" : "s")"
        return store.isConnected ? "\(photos) queued." : "\(photos) waiting for a workspace connection."
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
