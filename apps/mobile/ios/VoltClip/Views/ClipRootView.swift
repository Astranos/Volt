@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ClipRootView: View {
    @Bindable var store: ClipScannerStore
    @State private var isConnectionSheetPresented = false
    @State private var isPairingScannerPresented = false

    var body: some View {
        TabView(selection: $store.selectedTab) {
                ClipCaptureView(store: store, mode: .ocr) {
                    handleConnectButtonTapped()
                }
                    .tabItem { Label("Text", systemImage: "doc.text.viewfinder") }
                    .tag(ClipScannerStore.ClipTab.text)

                ClipCaptureView(store: store, mode: .barcode) {
                    handleConnectButtonTapped()
                }
                    .tabItem { Label("Barcode", systemImage: "barcode.viewfinder") }
                    .tag(ClipScannerStore.ClipTab.barcode)

                ClipCaptureView(store: store, mode: .photo) {
                    handleConnectButtonTapped()
                }
                    .tabItem { Label("Photos", systemImage: "camera.viewfinder") }
                    .tag(ClipScannerStore.ClipTab.photos)

                ClipUploadView(store: store) {
                    handleConnectButtonTapped()
                }
                    .tabItem { Label("Upload", systemImage: "square.and.arrow.up") }
                    .tag(ClipScannerStore.ClipTab.upload)
        }
        .sheet(isPresented: $isConnectionSheetPresented) {
            ClipConnectionSheet(
                store: store,
                onDisconnect: {
                    isConnectionSheetPresented = false
                    store.disconnect()
                },
                onScanQRCode: {
                    isConnectionSheetPresented = false
                    if store.isConnected {
                        store.disconnect()
                    }
                    showPairingScanner()
                }
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
            .presentationBackground(Color(uiColor: .systemBackground))
            .interactiveDismissDisabled(store.isPairing)
        }
        .fullScreenCover(isPresented: $isPairingScannerPresented) {
            ClipPairingScannerView(store: store) {
                isPairingScannerPresented = false
            }
        }
        .onChange(of: store.pairingFailureMessage) { _, message in
            if message != nil && !store.isConnected {
                isConnectionSheetPresented = true
            }
        }
        .onChange(of: store.isPairing) { _, isPairing in
            if isPairing {
                isConnectionSheetPresented = true
            }
        }
        .onChange(of: store.isConnected) { _, isConnected in
            if isConnected {
                isConnectionSheetPresented = false
            }
        }
    }

    private func handleConnectButtonTapped() {
        if store.isConnected {
            isConnectionSheetPresented = true
            return
        }
        if store.isPairing {
            isConnectionSheetPresented = true
            return
        }
        if store.canReconnectToLastSession || store.pairingFailureMessage != nil {
            isConnectionSheetPresented = true
        } else {
            showPairingScanner()
        }
    }

    private func showPairingScanner() {
        isConnectionSheetPresented = false
        isPairingScannerPresented = true
    }
}

private struct ClipCaptureView: View {
    @Bindable var store: ClipScannerStore
    let mode: CaptureMode
    let onScanQRCode: () -> Void
    @State private var isCaptureSessionPresented = false
    @State private var captureSessionBatchId: String?
    @State private var opensPairingScannerAfterCapture = false
    @State private var expandedBatchIds: Set<String> = []
    @State private var previewedPhoto: ClipScannerStore.ClipPhoto?
    @State private var isTargetPickerPresented = false

    private var capturePhotoBatches: [ClipPhotoBatch] {
        let capturePhotos = store.photos.filter { $0.source == .capture }
        let grouped = Dictionary(grouping: capturePhotos) { photo in
            photo.batchId ?? photo.id.uuidString
        }
        return grouped.map { key, photos in
            ClipPhotoBatch(
                id: key,
                photos: photos.sorted { $0.capturedAt < $1.capturedAt }
            )
        }
        .sorted { $0.latestCapturedAt > $1.latestCapturedAt }
    }

    private var matchingCaptures: [ClipScannerStore.ClipCapture] {
        store.captures
            .filter { $0.mode == mode }
            .sorted { $0.capturedAt > $1.capturedAt }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ClipChromeSectionHeader(
                        title: mode.clipTabTitle,
                        connection: connectionSummary,
                        onConnectionTapped: onScanQRCode
                    )

                    if (mode == .ocr || mode == .barcode) && store.canChooseWorkspaceComputer {
                        ClipWorkspaceTargetCard(store: store) {
                            isTargetPickerPresented = true
                        }
                    }

                    if mode == .photo {
                        ClipCapturePhotoBatchesSection(
                            batches: capturePhotoBatches,
                            expandedBatchIds: expandedBatchIds,
                            canAddPhotos: store.isConnected,
                            onAddPhotos: { batch in
                                guard store.isConnected else { return }
                                store.clearOcrReview()
                                store.activeCaptureMode = .photo
                                captureSessionBatchId = store.resumeCaptureSession(batchId: batch.id)
                                isCaptureSessionPresented = true
                            },
                            onToggleExpanded: { batch in
                                if expandedBatchIds.contains(batch.id) {
                                    expandedBatchIds.remove(batch.id)
                                } else {
                                    expandedBatchIds.insert(batch.id)
                                }
                            },
                            onPreview: { photo in
                                previewedPhoto = photo
                            },
                            onDeletePhoto: { photo in
                                store.removePhoto(id: photo.id)
                            },
                            onDeleteBatch: { batch in
                                store.removePhotos(batchId: batch.id)
                                expandedBatchIds.remove(batch.id)
                            }
                        )
                    } else {
                        ClipRecentCapturesSection(mode: mode, captures: matchingCaptures)
                    }
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle(mode.clipTabTitle)
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(
                isPresented: $isCaptureSessionPresented,
                onDismiss: {
                    if mode == .photo {
                        store.endCaptureSession(id: captureSessionBatchId)
                    }
                    captureSessionBatchId = nil
                    if opensPairingScannerAfterCapture {
                        opensPairingScannerAfterCapture = false
                        onScanQRCode()
                    }
                }
            ) {
                ClipCaptureSessionView(
                    store: store,
                    activeMode: $store.activeCaptureMode,
                    isConnected: store.isConnected,
                    isRecognizingText: store.isRecognizingText,
                    ocrReviewImage: store.ocrReviewImage,
                    ocrTextRegions: store.ocrTextRegions,
                    statusText: captureStatusText,
                    captureBatchId: captureSessionBatchId,
                    onBarcodeScan: { scan in
                        store.handleBarcodeScan(scan)
                    },
                    onCaptureImage: { image, mode, batchId in
                        switch mode {
                        case .ocr:
                            Task { await store.recognizeText(in: image) }
                        case .barcode:
                            break
                        case .photo, .dictation:
                            Task { await store.capturePhoto(image, batchId: batchId) }
                        }
                    },
                    onSendRecognizedText: { text in
                        store.sendRecognizedText(text)
                    },
                    onClearOcrReview: {
                        store.clearOcrReview()
                    },
                    onConnectionScannerRequested: {
                        opensPairingScannerAfterCapture = true
                    }
                )
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ScannerBottomActionAccessory(
                    title: mode.clipStartActionTitle,
                    systemImage: mode.symbolName,
                    isEnabled: store.isConnected,
                    isConnecting: store.isPairing,
                    statusText: captureStatusText,
                    disabledHint: store.targetHint,
                    action: {
                        guard store.isConnected else { return }
                        store.clearOcrReview()
                        store.activeCaptureMode = mode
                        captureSessionBatchId = mode == .photo ? store.beginCaptureSession() : nil
                        isCaptureSessionPresented = true
                    }
                )
            }
            .sheet(item: $previewedPhoto) { photo in
                ClipPhotoPreviewSheet(photo: photo) {
                    store.removePhoto(id: photo.id)
                    previewedPhoto = nil
                }
            }
            .sheet(isPresented: $isTargetPickerPresented) {
                ClipWorkspaceTargetPickerSheet(store: store)
            }
            .onAppear {
                store.activeCaptureMode = mode
            }
        }
    }

    private var connectionSummary: ScannerConnectionSummary {
        ScannerConnectionSummary(
            isConnected: store.isConnected,
            isBusy: store.isPairing,
            title: clipConnectionTitle(
                isConnected: store.isConnected,
                isPairing: store.isPairing,
                pairingLabel: store.pairingLabel,
                pairingFailureMessage: store.pairingFailureMessage
            ),
            statusText: store.statusText
        )
    }

    private var captureStatusText: String {
        if store.isPairing {
            store.statusText
        } else if store.isConnected {
            "Ready to \(mode.clipActionVerb) into \(store.typingTargetLabel)"
        } else {
            store.targetHint
        }
    }
}

private struct ClipWorkspaceTargetCard: View {
    @Bindable var store: ClipScannerStore
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: "cursorarrow.motionlines")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.green)
                    .frame(width: 46, height: 46)
                    .background(.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))

                VStack(alignment: .leading, spacing: 3) {
                    Text("Typing to \(store.typingTargetLabel)")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text("Choose from \(store.availableWorkspaceComputers.count) online workspace computer\(store.availableWorkspaceComputers.count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Changes the computer that receives text and barcode captures.")
    }
}

private struct ClipWorkspaceTargetPickerSheet: View {
    @Bindable var store: ClipScannerStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Workspace Computers") {
                    if store.isLoadingWorkspaceComputers && store.workspaceComputers.isEmpty {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Loading computers…")
                                .foregroundStyle(.secondary)
                        }
                    } else if store.availableWorkspaceComputers.isEmpty {
                        ContentUnavailableView(
                            "No Computers Online",
                            systemImage: "desktopcomputer",
                            description: Text("Open the signed-in Volt extension on a computer to make it available.")
                        )
                    } else {
                        ForEach(store.availableWorkspaceComputers) { computer in
                            targetButton(
                                title: computer.label,
                                subtitle: "Online · Ready for text and barcode captures",
                                deviceId: computer.deviceId
                            )
                        }
                    }
                }

                if !store.unavailableWorkspaceComputers.isEmpty {
                    Section("Offline") {
                        ForEach(store.unavailableWorkspaceComputers) { computer in
                            Label(computer.label, systemImage: "desktopcomputer")
                                .foregroundStyle(.secondary)
                                .accessibilityLabel("\(computer.label), offline")
                        }
                    }
                }

                if let error = store.workspaceComputerError {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Type to Computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .refreshable {
                await store.refreshWorkspaceComputers()
            }
            .task {
                await store.refreshWorkspaceComputers()
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func targetButton(title: String, subtitle: String, deviceId: String?) -> some View {
        Button {
            store.selectWorkspaceComputer(deviceId: deviceId)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: deviceId == nil ? "link" : "desktopcomputer")
                    .foregroundStyle(.green)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if store.selectedWorkspaceComputerId == deviceId {
                    Image(systemName: "checkmark")
                        .font(.headline)
                        .foregroundStyle(.green)
                }
            }
        }
    }
}

private struct ClipRecentCapturesSection: View {
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

private extension CaptureMode {
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

private struct ClipUploadView: View {
    @Bindable var store: ClipScannerStore
    let onScanQRCode: () -> Void
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var isPreparingUploads = false
    @State private var selectedUploadTotal = 0
    @State private var selectedUploadPrepared = 0
    @State private var uploadError: String?
    @State private var queuedUploadSelections: [[PhotosPickerItem]] = []
    @State private var isProcessingUploadQueue = false
    @State private var expandedBatchIds: Set<String> = []

    private var uploadPhotoBatches: [ClipUploadPhotoBatch] {
        let uploadPhotos = store.photos.filter { $0.source == .upload }
        let grouped = Dictionary(grouping: uploadPhotos) { photo in
            photo.batchId ?? photo.id.uuidString
        }

        return grouped.map { key, photos in
            let progress = store.photoUploadProgress?.id == key ? store.photoUploadProgress : nil
            return ClipUploadPhotoBatch(
                id: key,
                photos: photos.sorted { $0.capturedAt < $1.capturedAt },
                expectedTotal: progress?.total ?? photos.count,
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
                    ClipChromeSectionHeader(
                        title: "Upload",
                        connection: connectionSummary,
                        onConnectionTapped: onScanQRCode
                    )

                    if isPreparingUploads {
                        PhotoPreparationProgressSummary(
                            prepared: selectedUploadPrepared,
                            total: selectedUploadTotal
                        )
                    } else if let progress = activeUploadProgress {
                        PhotoUploadProgressSummary(progress: progress)
                    }

                    ClipUploadPhotoBatchesSection(
                        batches: uploadPhotoBatches,
                        expandedBatchIds: expandedBatchIds,
                        onToggleExpanded: { batch in
                            if expandedBatchIds.contains(batch.id) {
                                expandedBatchIds.remove(batch.id)
                            } else {
                                expandedBatchIds.insert(batch.id)
                            }
                        },
                        onDeletePhoto: { photo in
                            store.removePhoto(id: photo.id)
                        },
                        onDeleteBatch: { batch in
                            store.removePhotos(batchId: batch.id)
                            expandedBatchIds.remove(batch.id)
                        }
                    )
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Upload")
            .toolbar(.hidden, for: .navigationBar)
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
            .safeAreaInset(edge: .bottom, spacing: 0) {
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
            }
        }
    }

    private var connectionSummary: ScannerConnectionSummary {
        ScannerConnectionSummary(
            isConnected: store.isConnected,
            isBusy: store.isPairing,
            title: clipConnectionTitle(
                isConnected: store.isConnected,
                isPairing: store.isPairing,
                pairingLabel: store.pairingLabel,
                pairingFailureMessage: store.pairingFailureMessage
            ),
            statusText: store.statusText
        )
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

private struct ClipUploadPhotoBatch: Identifiable, Equatable {
    let id: String
    let photos: [ClipScannerStore.ClipPhoto]
    let expectedTotal: Int
    let isActive: Bool

    var latestCapturedAt: Date {
        photos.map(\.capturedAt).max() ?? .distantPast
    }

    var title: String {
        if isActive {
            return "Uploading \(photos.count) of \(expectedTotal) photo\(expectedTotal == 1 ? "" : "s")"
        }
        return "Uploaded \(photos.count) photo\(photos.count == 1 ? "" : "s")"
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

private struct ClipUploadPhotoBatchesSection: View {
    let batches: [ClipUploadPhotoBatch]
    let expandedBatchIds: Set<String>
    let onToggleExpanded: (ClipUploadPhotoBatch) -> Void
    let onDeletePhoto: (ClipScannerStore.ClipPhoto) -> Void
    let onDeleteBatch: (ClipUploadPhotoBatch) -> Void

    private var photoCount: Int {
        batches.reduce(0) { $0 + $1.photos.count }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recent Uploads")
                    .font(.headline)
                Spacer()
                Text("\(photoCount)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if batches.isEmpty {
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
                    ForEach(batches) { batch in
                        ClipUploadPhotoBatchCard(
                            batch: batch,
                            isExpanded: expandedBatchIds.contains(batch.id),
                            onToggleExpanded: {
                                onToggleExpanded(batch)
                            },
                            onDeletePhoto: onDeletePhoto,
                            onDeleteBatch: {
                                onDeleteBatch(batch)
                            }
                        )
                    }
                }
            }
        }
    }
}

private struct ClipUploadPhotoBatchCard: View {
    let batch: ClipUploadPhotoBatch
    let isExpanded: Bool
    let onToggleExpanded: () -> Void
    let onDeletePhoto: (ClipScannerStore.ClipPhoto) -> Void
    let onDeleteBatch: () -> Void

    private var visiblePhotos: [ClipScannerStore.ClipPhoto] {
        isExpanded ? batch.photos : Array(batch.photos.prefix(4))
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

                ClipPhotoStatusBadge(status: batch.statusText)

                Button(role: .destructive, action: onDeleteBatch) {
                    Image(systemName: "trash")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Delete upload batch")
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 86), spacing: 8)], spacing: 8) {
                ForEach(visiblePhotos) { photo in
                    ClipUploadPhotoThumbnail(photo: photo) {
                        onDeletePhoto(photo)
                    }
                }
            }

            if batch.photos.count > 4 {
                Button(action: onToggleExpanded) {
                    Label(
                        isExpanded ? "Show fewer photos" : "View all \(batch.photos.count) photos",
                        systemImage: isExpanded ? "chevron.up" : "photo.stack"
                    )
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)
            }
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct ClipPhotoStatusBadge: View {
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

private struct ClipUploadPhotoThumbnail: View {
    let photo: ClipScannerStore.ClipPhoto
    let onDelete: () -> Void

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topTrailing) {
                Image(uiImage: photo.image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .clipped()

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

private struct ClipPhotoBatch: Identifiable, Equatable {
    let id: String
    let photos: [ClipScannerStore.ClipPhoto]

    var latestCapturedAt: Date {
        photos.map(\.capturedAt).max() ?? .distantPast
    }

    var title: String {
        "\(photos.count) captured photo\(photos.count == 1 ? "" : "s")"
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

private struct ClipCapturePhotoBatchesSection: View {
    let batches: [ClipPhotoBatch]
    let expandedBatchIds: Set<String>
    let canAddPhotos: Bool
    let onAddPhotos: (ClipPhotoBatch) -> Void
    let onToggleExpanded: (ClipPhotoBatch) -> Void
    let onPreview: (ClipScannerStore.ClipPhoto) -> Void
    let onDeletePhoto: (ClipScannerStore.ClipPhoto) -> Void
    let onDeleteBatch: (ClipPhotoBatch) -> Void

    private var photoCount: Int {
        batches.reduce(0) { $0 + $1.photos.count }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Previously Captured")
                    .font(.headline)
                Spacer()
                Text("\(photoCount)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if batches.isEmpty {
                ContentUnavailableView(
                    "No Captures Yet",
                    systemImage: "photo.stack",
                    description: Text("Finished captures will show here after you leave the camera session.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 34)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                VStack(spacing: 10) {
                    ForEach(batches) { batch in
                        ClipCapturePhotoBatchCard(
                            batch: batch,
                            isExpanded: expandedBatchIds.contains(batch.id),
                            canAddPhotos: canAddPhotos,
                            onAddPhotos: {
                                onAddPhotos(batch)
                            },
                            onToggleExpanded: {
                                onToggleExpanded(batch)
                            },
                            onPreview: onPreview,
                            onDeletePhoto: onDeletePhoto,
                            onDeleteBatch: {
                                onDeleteBatch(batch)
                            }
                        )
                    }
                }
            }
        }
    }
}

private struct ClipCapturePhotoBatchCard: View {
    let batch: ClipPhotoBatch
    let isExpanded: Bool
    let canAddPhotos: Bool
    let onAddPhotos: () -> Void
    let onToggleExpanded: () -> Void
    let onPreview: (ClipScannerStore.ClipPhoto) -> Void
    let onDeletePhoto: (ClipScannerStore.ClipPhoto) -> Void
    let onDeleteBatch: () -> Void

    private var visiblePhotos: [ClipScannerStore.ClipPhoto] {
        isExpanded ? batch.photos : Array(batch.photos.suffix(4))
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
                .accessibilityLabel("Delete capture batch")
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 86), spacing: 8)], spacing: 8) {
                ForEach(visiblePhotos) { photo in
                    ClipCapturePhotoThumbnail(
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

            Button(action: onAddPhotos) {
                Label("Add Photos", systemImage: "plus.viewfinder")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canAddPhotos)
            .accessibilityLabel("Add photos to \(batch.title) from \(batch.latestCapturedAt.formatted(date: .abbreviated, time: .shortened))")

            if batch.photos.count > 4 {
                Button(action: onToggleExpanded) {
                    Label(
                        isExpanded ? "Show fewer photos" : "View all \(batch.photos.count) photos",
                        systemImage: isExpanded ? "chevron.up" : "photo.stack"
                    )
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

private struct ClipCapturePhotoThumbnail: View {
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
                .accessibilityLabel("Preview captured photo")

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

private struct ClipPhotoPreviewSheet: View {
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

private struct ClipChromeSectionHeader: View {
    let title: String
    let connection: ScannerConnectionSummary
    let onConnectionTapped: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title)
                .font(.largeTitle.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .frame(maxWidth: .infinity, alignment: .leading)

            Button(action: onConnectionTapped) {
                HStack(spacing: 8) {
                    if connection.isBusy {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.primary)
                    } else {
                        Image(systemName: connectionIcon)
                            .font(.subheadline.weight(.semibold))
                    }

                    Text(connection.title)
                        .font(.headline)
                        .lineLimit(1)
                        .minimumScaleFactor(0.76)
                }
                .foregroundStyle(connectionColor)
                .padding(.horizontal, 18)
                .frame(minHeight: 44)
                .background(.regularMaterial, in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(connection.isConnected ? connection.statusText : "Connect to workspace")
            .accessibilityHint(connection.isBusy ? "Shows connection progress." : "Shows connection options.")
        }
    }

    private var connectionIcon: String {
        if connection.isConnected {
            return "checkmark.circle.fill"
        }
        if connection.title == "Failed" {
            return "exclamationmark.triangle.fill"
        }
        return "desktopcomputer"
    }

    private var connectionColor: Color {
        if connection.isConnected {
            return .green
        }
        if connection.title == "Failed" {
            return .red
        }
        return .secondary
    }
}

private struct ClipConnectionSheet: View {
    @Bindable var store: ClipScannerStore
    let onDisconnect: () -> Void
    let onScanQRCode: () -> Void

    var body: some View {
        Group {
            if store.isPairing {
                ClipConnectionProgressView(
                    store: store,
                    onCancel: {
                        store.cancelConnectionAttempt()
                    },
                    onScanQRCode: {
                        store.cancelConnectionAttempt()
                        onScanQRCode()
                    }
                )
            } else if store.pairingFailureMessage != nil {
                ClipPairingFailureView(store: store, onScanQRCode: onScanQRCode)
            } else {
                ClipConnectChoicesView(
                    store: store,
                    onReconnect: {
                        store.reconnectToLastSession()
                    },
                    onDisconnect: onDisconnect,
                    onScanQRCode: onScanQRCode
                )
            }
        }
    }
}

private struct ClipConnectChoicesView: View {
    @Bindable var store: ClipScannerStore
    @Environment(\.dismiss) private var dismiss
    let onReconnect: () -> Void
    let onDisconnect: () -> Void
    let onScanQRCode: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Label("Workspace", systemImage: "desktopcomputer")
                    .font(.title2.bold())
                    .foregroundStyle(.primary)

                if store.isConnected {
                    Text("Choose which workspace computer receives captures, or scan a QR code for a different workspace.")
                        .font(.body)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)

                    ClipDetailRow(
                        title: "Connected",
                        value: store.connectionAttemptDisplayName,
                        systemImage: "checkmark.circle"
                    )
                    .padding(14)
                    .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                } else if let displayName = store.lastSessionDisplayName {
                    Text("Reconnect to \(displayName), or scan a QR code for a different workspace.")
                        .font(.body)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)

                    ClipDetailRow(
                        title: "Last Session",
                        value: displayName,
                        systemImage: "clock.arrow.circlepath"
                    )
                    .padding(14)
                    .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                } else {
                    Text("Scan the Volt App Clip QR from Chrome to open its workspace.")
                        .font(.body)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                VStack(spacing: 10) {
                    if store.isConnected {
                        Button(role: .destructive) {
                            onDisconnect()
                        } label: {
                            Label("Disconnect", systemImage: "xmark.circle")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 62)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                    } else if store.lastSessionDisplayName != nil {
                        Button {
                            onReconnect()
                        } label: {
                            Label("Reconnect", systemImage: "arrow.clockwise")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 62)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                    }

                    Button {
                        onScanQRCode()
                    } label: {
                        Label("Scan QR", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 62)
                    }
                    .buttonStyle(.bordered)
                    .tint(.green)
                }
            }
            .padding(ScannerTabLayout.contentPadding)
            .navigationTitle("Workspace")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

private struct ClipConnectionProgressView: View {
    @Bindable var store: ClipScannerStore
    let onCancel: () -> Void
    let onScanQRCode: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.large)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Connecting")
                            .font(.title2.bold())
                        Text(store.connectionAttemptDisplayName)
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }

                ClipDetailRow(
                    title: "Workspace",
                    value: store.connectionAttemptDisplayName,
                    systemImage: "desktopcomputer"
                )

                ClipDetailRow(
                    title: "Status",
                    value: store.statusText,
                    systemImage: "waveform.path.ecg"
                )

                Spacer(minLength: 0)

                VStack(spacing: 10) {
                    Button(role: .cancel) {
                        onCancel()
                    } label: {
                        Label("Cancel", systemImage: "xmark.circle")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 62)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        onScanQRCode()
                    } label: {
                        Label("Scan QR", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 62)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }
            }
            .padding(ScannerTabLayout.contentPadding)
            .navigationTitle("Connecting")
        }
    }
}

private struct ClipPairingFailureView: View {
    @Bindable var store: ClipScannerStore
    @Environment(\.dismiss) private var dismiss
    let onScanQRCode: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Label("Connection Failed", systemImage: "exclamationmark.triangle.fill")
                    .font(.title2.bold())
                    .foregroundStyle(.red)

                Text(store.pairingFailureMessage ?? "The App Clip could not connect to the workspace.")
                    .font(.body)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Retry can help if the network was slow. If the QR expired or opened the wrong workspace, create and scan a fresh Volt QR code.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)

                VStack(spacing: 10) {
                    Button {
                        store.retryFailedConnection()
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 62)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(!store.canRetryConnection)

                    Button {
                        onScanQRCode()
                    } label: {
                        Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 62)
                    }
                    .buttonStyle(.bordered)
                    .tint(.green)
                }
            }
            .padding(ScannerTabLayout.contentPadding)
            .navigationTitle("Chrome Session")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

private struct ClipDetailRow: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ClipCaptureSessionView: View {
    @Bindable var store: ClipScannerStore
    @Binding var activeMode: CaptureMode
    let isConnected: Bool
    let isRecognizingText: Bool
    let ocrReviewImage: UIImage?
    let ocrTextRegions: [RecognizedTextRegion]
    let statusText: String
    let captureBatchId: String?
    let onBarcodeScan: (ClipBarcodeScan) -> Void
    let onCaptureImage: (UIImage, CaptureMode, String?) -> Void
    let onSendRecognizedText: (String) -> Void
    let onClearOcrReview: () -> Void
    let onConnectionScannerRequested: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var cameraService = ClipBarcodeScannerService()
    @State private var captureError: String?
    @State private var captureNotice: String?
    @State private var isCapturingPhoto = false
    @State private var gridVisible = true
    @State private var liveTextCandidates: [LiveTextCandidate] = []
    @State private var detectedBarcodeBounds: CGRect?
    @State private var detectedBarcodeFormat: String?
    @State private var selectedTextRegion: RecognizedTextRegion?
    @State private var selectedCleanedText: String?
    @State private var isCleaningSelectedText = false
    @State private var focusPoint: CGPoint?
    @State private var cameraStateRevision = 0
    @State private var isConnectionSheetPresented = false
    private let topToolbarTopPadding: CGFloat = 12
    private let topToolbarHeight: CGFloat = 42
    private let photoPreviewToolbarGap: CGFloat = 0

    private var capturedSessionPhotos: [ClipScannerStore.ClipPhoto] {
        store.photos
            .filter { photo in
                photo.source == .capture
                    && (captureBatchId == nil || photo.batchId == captureBatchId)
            }
            .sorted { $0.capturedAt > $1.capturedAt }
    }

    private var capturedThumbnails: [SessionPhotoThumbnail] {
        capturedSessionPhotos
            .prefix(ClipScannerStore.sessionPhotoStripLimit)
            .map { SessionPhotoThumbnail(id: $0.id, image: $0.image) }
    }

    var body: some View {
        let captureSurface = ZStack {
            if let ocrReviewImage {
                OcrReviewLayer(
                    image: ocrReviewImage,
                    regions: ocrTextRegions,
                    selectedRegion: selectedTextRegion,
                    imageContentMode: .fit,
                    fillFocusX: 0.5,
                    onSelectRegion: { selectTextRegion($0) }
                )
                .ignoresSafeArea()
            } else {
                ClipCaptureSessionBackdrop(
                    cameraService: cameraService,
                    activeMode: activeMode,
                    gridVisible: gridVisible,
                    detectedBarcodeBounds: detectedBarcodeBounds,
                    detectedBarcodeFormat: detectedBarcodeFormat,
                    focusPoint: focusPoint,
                    onTap: { devicePoint, layerPoint in
                        focusPoint = layerPoint
                        cameraService.focus(at: devicePoint)
                        Task {
                            try? await Task.sleep(for: .milliseconds(750))
                            await MainActor.run {
                                if focusPoint == layerPoint {
                                    focusPoint = nil
                                }
                            }
                        }
                    },
                    onPinch: { scale, phase in
                        cameraService.handleZoomGesture(scale: scale, phase: phase)
                    }
                )
                .ignoresSafeArea()
            }

            VStack {
                HStack {
                    Label(activeModeTitle, systemImage: activeMode.symbolName)
                        .font(.headline)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .frame(minHeight: topToolbarHeight)
                        .background(.black.opacity(0.48), in: Capsule())

                    Spacer()

                    Button {
                        onClearOcrReview()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: topToolbarHeight, height: topToolbarHeight)
                            .background(.black.opacity(0.48), in: Circle())
                    }
                    .accessibilityLabel("End session")
                }
                .padding(.horizontal, 18)
                .padding(.top, topToolbarTopPadding)

                if let captureError {
                    Label(captureError, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(.red.opacity(0.82), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .padding(.horizontal, 18)
                        .padding(.top, 8)
                } else if let captureNotice {
                    Label(captureNotice, systemImage: isCapturingPhoto ? "camera.aperture" : "checkmark.circle.fill")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(.black.opacity(0.58), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .padding(.horizontal, 18)
                        .padding(.top, 8)
                }

                if activeMode == .photo, ocrReviewImage == nil {
                    GeometryReader { previewGeometry in
                        let side = previewGeometry.size.width

                        ClipPhotoPreview(
                            cameraService: cameraService,
                            gridVisible: gridVisible,
                            focusPoint: focusPoint,
                            onTap: { devicePoint, layerPoint in
                                focusPoint = layerPoint
                                cameraService.focus(at: devicePoint)
                                Task {
                                    try? await Task.sleep(for: .milliseconds(750))
                                    await MainActor.run {
                                        if focusPoint == layerPoint {
                                            focusPoint = nil
                                        }
                                    }
                                }
                            },
                            onPinch: { scale, phase in
                                cameraService.handleZoomGesture(scale: scale, phase: phase)
                            }
                        )
                        .frame(width: side, height: side)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    }
                    .padding(.top, photoPreviewToolbarGap)
                } else {
                    Spacer()
                }
            }

            if let selectedTextRegion {
                ExtractedTextActionCard(
                    text: selectedTextPreview,
                    isCleaning: isCleaningSelectedText,
                    onCleanup: {
                        cleanupSelectedText(selectedTextRegion)
                    },
                    onSend: {
                        onSendRecognizedText(selectedCleanedText ?? selectedTextRegion.text)
                        self.selectedTextRegion = nil
                        selectedCleanedText = nil
                    },
                    onDismiss: {
                        self.selectedTextRegion = nil
                        selectedCleanedText = nil
                    }
                )
                .transition(.scale(scale: 0.96).combined(with: .opacity))
            }
        }
        .background(.black)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if ocrReviewImage != nil {
                ClipOcrReviewControls(
                    regionCount: ocrTextRegions.count,
                    onRetake: {
                        selectedTextRegion = nil
                        selectedCleanedText = nil
                        cameraService.setTorchEnabled(false)
                        onClearOcrReview()
                    },
                    onFinish: {
                        selectedTextRegion = nil
                        selectedCleanedText = nil
                        onClearOcrReview()
                        dismiss()
                    }
                )
            } else {
                VStack(spacing: 6) {
                    if activeMode == .ocr {
                        LiveIdentifierStrip(
                            candidates: liveTextCandidates,
                            onSend: { candidate in
                                onSendRecognizedText(candidate.value)
                            }
                        )
                    }

                    CameraSessionControls(
                        activeMode: $activeMode,
                        torchEnabled: cameraService.torchEnabled,
                        zoomLabel: cameraService.zoomDisplayLabel,
                        gridVisible: gridVisible,
                        hasLiveTextCandidates: !liveTextCandidates.isEmpty,
                        isRecognizingText: isRecognizingText || isCapturingPhoto,
                        isCaptureEnabled: isConnected && !isCapturingPhoto && !isRecognizingText,
                        showsModePicker: false,
                        barcodeHint: detectedBarcodeBounds == nil ? "Point camera at barcode" : "Barcode found",
                        hasLatestCapture: false,
                        capturedThumbnails: activeMode == .photo ? capturedThumbnails : [],
                        capturedCount: activeMode == .photo ? capturedSessionPhotos.count : 0,
                        controlRotation: .degrees(cameraService.captureOrientation.controlRotationDegrees),
                        onToggleTorch: {
                            cameraService.setTorchEnabled(!cameraService.torchEnabled)
                        },
                        onZoomOut: {
                            cameraService.adjustZoom(by: -0.25)
                        },
                        onZoomIn: {
                            cameraService.adjustZoom(by: 0.25)
                        },
                        onToggleGrid: {
                            gridVisible.toggle()
                        },
                        onCapture: {
                            captureCurrentFrame()
                        },
                        onSendLatest: nil,
                        onFinish: {
                            dismiss()
                        }
                    )
                }
            }
        }
        return captureSurface
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: selectedTextRegion?.id)
        .sheet(isPresented: $isConnectionSheetPresented) {
            ClipConnectionSheet(
                store: store,
                onDisconnect: {
                    store.disconnect()
                },
                onScanQRCode: {
                    isConnectionSheetPresented = false
                    onConnectionScannerRequested()
                    dismiss()
                }
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
            .presentationBackground(Color(uiColor: .systemBackground))
            .interactiveDismissDisabled(store.isPairing)
        }
        .onAppear {
            cameraService.onScan = { scan in
                if activeMode == .barcode || scan.isQRCode {
                    onBarcodeScan(scan)
                }
            }
            cameraService.onDetectedBarcode = { bounds, format in
                detectedBarcodeBounds = bounds
                detectedBarcodeFormat = format
            }
            cameraService.onLiveTextCandidates = { candidates in
                liveTextCandidates = candidates
            }
            cameraService.onCameraStateChanged = {
                cameraStateRevision += 1
            }
            cameraService.onError = { message in
                captureError = message
            }
            Task {
                await cameraService.requestAccessAndStart()
                syncCameraForOcrPostCapture()
            }
        }
        .onDisappear {
            cameraService.stop()
            cameraService.onScan = nil
            cameraService.onDetectedBarcode = nil
            cameraService.onLiveTextCandidates = nil
            cameraService.onCameraStateChanged = nil
            cameraService.onError = nil
        }
        .onChange(of: activeMode) { _, mode in
            syncCameraForOcrPostCapture()
            if mode != .barcode {
                cameraService.clearDetectedBarcode()
            }
        }
        .onChange(of: ocrReviewImage != nil) { _, isReviewing in
            syncCameraForOcrPostCapture()
            if isReviewing {
                selectedTextRegion = nil
                selectedCleanedText = nil
            }
        }
        .onChange(of: isRecognizingText) { _, _ in
            syncCameraForOcrPostCapture()
        }
        .onChange(of: store.isConnected) { _, isConnected in
            isConnectionSheetPresented = !isConnected
            if !isConnected {
                selectedTextRegion = nil
                selectedCleanedText = nil
                onClearOcrReview()
            }
        }
        .onChange(of: store.isPairing) { _, isPairing in
            if isPairing {
                isConnectionSheetPresented = true
            }
        }
        .onChange(of: store.pairingFailureMessage) { _, message in
            if message != nil && !store.isConnected {
                isConnectionSheetPresented = true
            }
        }
    }

    private func syncCameraForOcrPostCapture() {
        let shouldPauseCamera = activeMode == .ocr
            && (isRecognizingText || ocrReviewImage != nil)
        if shouldPauseCamera {
            cameraService.stop()
        } else {
            cameraService.start()
            cameraService.setLiveTextScanningEnabled(activeMode == .ocr)
            cameraService.setBarcodeScanningEnabled(activeMode == .barcode)
        }
    }

    private func selectTextRegion(_ region: RecognizedTextRegion) {
        selectedCleanedText = nil
        selectedTextRegion = region
    }

    private func cleanupSelectedText(_ region: RecognizedTextRegion) {
        isCleaningSelectedText = true
        captureError = nil
        captureNotice = "Cleaning text"
        Task {
            let result = await OcrTextCleaner.clean(text: region.text)
            selectedCleanedText = result.text
            selectedTextRegion = region
            isCleaningSelectedText = false
            captureNotice = result.usedFoundationModel ? "Text cleaned on device" : "Text cleaned"
        }
    }

    private func captureCurrentFrame() {
        guard !isCapturingPhoto else { return }
        let mode = activeMode
        let batchId = captureBatchId
        if mode == .barcode {
            if let latestScan = cameraService.latestScan {
                captureError = nil
                captureNotice = "Barcode sent"
                onBarcodeScan(latestScan)
            } else {
                captureError = "Frame a barcode before pressing the shutter."
                captureNotice = nil
            }
            return
        }
        isCapturingPhoto = true
        captureError = nil
        captureNotice = mode == .ocr ? "Capturing text image" : "Capturing photo"

        Task {
            do {
                let image = try await cameraService.capturePhoto(
                    matchingDeviceOrientation: mode == .photo
                )
                if mode == .ocr {
                    cameraService.stop()
                    onCaptureImage(image, mode, batchId)
                    captureNotice = successNotice(for: mode)
                } else if mode == .photo {
                    onCaptureImage(image, mode, batchId)
                    captureNotice = nil
                } else {
                    onCaptureImage(image, mode, batchId)
                    captureNotice = successNotice(for: mode)
                }
            } catch {
                captureError = error.localizedDescription
                captureNotice = nil
            }
            isCapturingPhoto = false
        }
    }

    private func successNotice(for mode: CaptureMode) -> String? {
        switch mode {
        case .ocr:
            "Text image captured"
        case .barcode:
            "Photo captured; live barcode scans send automatically"
        case .photo, .dictation:
            nil
        }
    }

    private var activeModeTitle: String {
        switch activeMode {
        case .ocr:
            "OCR"
        case .barcode:
            "Barcode"
        case .photo:
            "Photo"
        case .dictation:
            "Capture"
        }
    }

    private var selectedTextPreview: String {
        guard let selectedTextRegion else { return "" }
        guard let selectedCleanedText, selectedCleanedText != selectedTextRegion.text else {
            return selectedTextRegion.text
        }
        return """
        Cleaned
        \(selectedCleanedText)

        Original
        \(selectedTextRegion.text)
        """
    }
}

private struct ClipCaptureSessionBackdrop: View {
    let cameraService: ClipBarcodeScannerService
    let activeMode: CaptureMode
    let gridVisible: Bool
    let detectedBarcodeBounds: CGRect?
    let detectedBarcodeFormat: String?
    let focusPoint: CGPoint?
    let onTap: (CGPoint, CGPoint) -> Void
    let onPinch: (CGFloat, CameraZoomGesturePhase) -> Void

    var body: some View {
        ZStack(alignment: .top) {
            Color.black
                .ignoresSafeArea()

            if activeMode != .photo {
                ClipCameraPreview(service: cameraService, onTap: onTap, onPinch: onPinch)
                    .ignoresSafeArea()
                    .overlay {
                        CaptureGuideOverlay(mode: activeMode, gridVisible: gridVisible)
                            .allowsHitTesting(false)
                    }
                    .overlay(alignment: .topLeading) {
                        if activeMode == .barcode,
                           let detectedBarcodeBounds,
                           detectedBarcodeBounds.width > 0,
                           detectedBarcodeBounds.height > 0 {
                            BarcodeDetectionReticle(
                                bounds: detectedBarcodeBounds,
                                format: detectedBarcodeFormat
                            )
                            .allowsHitTesting(false)
                        }
                    }
                    .overlay(alignment: .topLeading) {
                        if let focusPoint {
                            FocusReticle()
                                .position(focusPoint)
                                .allowsHitTesting(false)
                        }
                    }
            }
        }
    }
}

private struct ClipPhotoPreview: View {
    let cameraService: ClipBarcodeScannerService
    let gridVisible: Bool
    let focusPoint: CGPoint?
    let onTap: (CGPoint, CGPoint) -> Void
    let onPinch: (CGFloat, CameraZoomGesturePhase) -> Void

    var body: some View {
        ClipCameraPreview(service: cameraService, onTap: onTap, onPinch: onPinch)
            .clipped()
            .overlay {
                if gridVisible {
                    SquareGrid()
                        .allowsHitTesting(false)
                }
            }
            .overlay {
                Rectangle()
                    .stroke(.white.opacity(0.28), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .overlay(alignment: .topLeading) {
                if let focusPoint {
                    FocusReticle()
                        .position(focusPoint)
                        .allowsHitTesting(false)
                }
            }
    }
}

private struct ClipCameraPreview: UIViewRepresentable {
    let service: ClipBarcodeScannerService
    let onTap: (CGPoint, CGPoint) -> Void
    let onPinch: (CGFloat, CameraZoomGesturePhase) -> Void

    func makeUIView(context: Context) -> ClipCameraPreviewHostView {
        let view = ClipCameraPreviewHostView(previewLayer: service.previewLayer)
        view.onTap = onTap
        view.onPinch = onPinch
        return view
    }

    func updateUIView(_ uiView: ClipCameraPreviewHostView, context: Context) {
        uiView.setPreviewLayer(service.previewLayer)
        uiView.onTap = onTap
        uiView.onPinch = onPinch
    }

    final class ClipCameraPreviewHostView: UIView {
        private var previewLayer: AVCaptureVideoPreviewLayer
        var onTap: ((CGPoint, CGPoint) -> Void)?
        var onPinch: ((CGFloat, CameraZoomGesturePhase) -> Void)?

        init(previewLayer: AVCaptureVideoPreviewLayer) {
            self.previewLayer = previewLayer
            super.init(frame: .zero)
            layer.addSublayer(previewLayer)
            let tapRecognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
            addGestureRecognizer(tapRecognizer)
            let pinchRecognizer = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
            addGestureRecognizer(pinchRecognizer)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }

        func setPreviewLayer(_ nextLayer: AVCaptureVideoPreviewLayer) {
            guard previewLayer !== nextLayer else { return }
            previewLayer.removeFromSuperlayer()
            previewLayer = nextLayer
            layer.addSublayer(nextLayer)
            setNeedsLayout()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            previewLayer.frame = bounds
        }

        @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
            let layerPoint = recognizer.location(in: self)
            let devicePoint = previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint)
            onTap?(devicePoint, layerPoint)
        }

        @objc private func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
            switch recognizer.state {
            case .began:
                onPinch?(recognizer.scale, .began)
            case .changed:
                onPinch?(recognizer.scale, .changed)
            case .ended, .cancelled, .failed:
                onPinch?(recognizer.scale, .ended)
            default:
                break
            }
        }
    }
}

private struct ClipOcrReviewControls: View {
    let regionCount: Int
    let onRetake: () -> Void
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("Tap highlighted text")
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)

            HStack(spacing: 12) {
                Button(action: onRetake) {
                    Label("Retake", systemImage: "arrow.clockwise")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .frame(minWidth: 104, minHeight: 48)
                        .background(.black.opacity(0.86), in: Capsule())
                        .overlay {
                            Capsule().stroke(.white.opacity(0.22), lineWidth: 1)
                        }
                }

                Spacer()

                Label("\(regionCount)", systemImage: "text.viewfinder")
                    .font(.subheadline.monospacedDigit().bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 48)
                    .background(.black.opacity(0.86), in: Capsule())
                    .overlay {
                        Capsule().stroke(.white.opacity(0.22), lineWidth: 1)
                    }
                    .accessibilityLabel("\(regionCount) recognized text regions")

                Spacer()

                Button(action: onFinish) {
                    Label("Finish", systemImage: "checkmark")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .frame(minWidth: 104, minHeight: 48)
                        .background(.black.opacity(0.86), in: Capsule())
                        .overlay {
                            Capsule().stroke(.white.opacity(0.22), lineWidth: 1)
                        }
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 22)
        .background {
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.88), .black.opacity(0.98)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        }
    }
}

private struct ClipPairingScannerView: View {
    @Bindable var store: ClipScannerStore
    let onFinish: () -> Void
    @State private var hasDetectedCode = false

    var body: some View {
        ZStack {
            ClipQRCodeScannerView { value in
                hasDetectedCode = true
                if store.pairFromScannedValue(value) {
                    onFinish()
                }
            }
            .ignoresSafeArea()

            VStack {
                Spacer()

                PairingScanControls(
                    statusText: store.statusText,
                    statusDetail: statusDetail,
                    onFinish: onFinish
                )
            }
        }
        .background(.black)
    }

    private var statusDetail: String {
        if store.isPairing {
            return "QR accepted. Starting the pairing request."
        }
        if store.isConnected {
            return "Ready to send captures back to the browser."
        }
        if store.errorMessage != nil {
            return "Try refreshing the pairing QR and scan it again."
        }
        return hasDetectedCode ? "Hold steady while the QR is read." : "Center the browser pairing QR in the frame."
    }
}

private struct ClipQRCodeScannerView: UIViewRepresentable {
    let onCode: (String) -> Void

    func makeUIView(context: Context) -> QRPreviewView {
        let view = QRPreviewView()
        view.previewLayer.videoGravity = .resizeAspectFill
        context.coordinator.configureSession(for: view)
        return view
    }

    func updateUIView(_ uiView: QRPreviewView, context: Context) {}

    static func dismantleUIView(_ uiView: QRPreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode)
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
        private let onCode: (String) -> Void
        private let session = AVCaptureSession()
        private var didEmitCode = false

        init(onCode: @escaping (String) -> Void) {
            self.onCode = onCode
            super.init()
        }

        func configureSession(for view: QRPreviewView) {
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                Task { @MainActor in
                    startSession(for: view)
                }
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { [weak self, weak view] granted in
                    guard granted, let self, let view else { return }
                    Task { @MainActor in
                        self.startSession(for: view)
                    }
                }
            case .denied, .restricted:
                break
            @unknown default:
                break
            }
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard !didEmitCode else { return }
            guard let qrObject = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first(where: { $0.type == .qr }),
                  let value = qrObject.stringValue else { return }
            didEmitCode = true
            onCode(value)
        }

        func stop() {
            guard session.isRunning else { return }
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                session.stopRunning()
            }
        }

        @MainActor
        private func startSession(for view: QRPreviewView) {
            guard !session.isRunning else { return }
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else { return }

            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }

            session.beginConfiguration()
            session.addInput(input)
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = output.availableMetadataObjectTypes.contains(.qr) ? [.qr] : []
            session.commitConfiguration()

            view.previewLayer.session = session
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                session.startRunning()
            }
        }
    }

    final class QRPreviewView: UIView {
        override class var layerClass: AnyClass {
            AVCaptureVideoPreviewLayer.self
        }

        var previewLayer: AVCaptureVideoPreviewLayer {
            layer as! AVCaptureVideoPreviewLayer
        }
    }
}
