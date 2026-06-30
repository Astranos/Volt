@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit
import WebKit

struct ClipRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var store: ClipScannerStore
    @State private var isConnectChoicesPresented = false
    @State private var isConnectionProgressPresented = false
    @State private var isPairingFailurePresented = false
    @State private var isPairingScannerPresented = false

    var body: some View {
        ZStack {
            TabView(selection: $store.selectedTab) {
                ClipCaptureView(store: store) {
                    handleConnectButtonTapped()
                }
                    .tabItem { Label("Capture", systemImage: "camera.viewfinder") }
                    .tag(ClipScannerStore.ClipTab.capture)

                ClipDictationView(store: store) {
                    handleConnectButtonTapped()
                }
                    .tabItem { Label("Dictate", systemImage: "mic") }
                    .tag(ClipScannerStore.ClipTab.dictate)

                ClipUploadView(store: store) {
                    handleConnectButtonTapped()
                }
                    .tabItem { Label("Upload", systemImage: "square.and.arrow.up") }
                    .tag(ClipScannerStore.ClipTab.upload)
            }

            ClipWebRTCBridgeView(webView: store.bridgeWebView)
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .allowsHitTesting(false)
        }
        .sheet(isPresented: $isConnectChoicesPresented) {
            ClipConnectChoicesView(
                store: store,
                onReconnect: {
                    isConnectChoicesPresented = false
                    store.reconnectToLastSession()
                },
                onScanQRCode: {
                    isConnectChoicesPresented = false
                    showPairingScanner()
                }
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $isConnectionProgressPresented) {
            ClipConnectionProgressView(
                store: store,
                onCancel: {
                    store.cancelConnectionAttempt()
                    isConnectionProgressPresented = false
                },
                onScanQRCode: {
                    store.cancelConnectionAttempt()
                    isConnectionProgressPresented = false
                    showPairingScanner()
                }
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
            .interactiveDismissDisabled(store.isPairing)
        }
        .sheet(isPresented: $isPairingFailurePresented) {
            ClipPairingFailureView(
                store: store,
                onScanQRCode: {
                    isPairingFailurePresented = false
                    showPairingScanner()
                }
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $isPairingScannerPresented) {
            ClipPairingScannerView(store: store) {
                isPairingScannerPresented = false
            }
        }
        .onChange(of: store.pairingFailureMessage) { _, message in
            isPairingFailurePresented = message != nil && !store.isConnected
        }
        .onChange(of: store.isPairing) { _, isPairing in
            isConnectionProgressPresented = isPairing
        }
        .onChange(of: store.isConnected) { _, isConnected in
            if isConnected {
                isConnectChoicesPresented = false
                isConnectionProgressPresented = false
            }
        }
        .onChange(of: scenePhase) { _, newValue in
            store.updateAppIsInBackground(newValue != .active)
        }
    }

    private func handleConnectButtonTapped() {
        if store.isConnected {
            store.disconnect()
            return
        }
        if store.isPairing {
            isConnectionProgressPresented = true
            return
        }
        if store.canReconnectToLastSession {
            isConnectChoicesPresented = true
        } else {
            showPairingScanner()
        }
    }

    private func showPairingScanner() {
        isPairingFailurePresented = false
        isPairingScannerPresented = true
    }
}

private struct ClipCaptureView: View {
    @Bindable var store: ClipScannerStore
    let onScanQRCode: () -> Void
    @State private var isCaptureSessionPresented = false
    @State private var captureSessionBatchId: String?
    @State private var expandedBatchIds: Set<String> = []
    @State private var previewedPhoto: ClipScannerStore.ClipPhoto?

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

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ClipChromeSectionHeader(
                        title: "Capture",
                        connection: connectionSummary,
                        onConnectionTapped: onScanQRCode
                    )

                    ClipCapturePhotoBatchesSection(
                        batches: capturePhotoBatches,
                        expandedBatchIds: expandedBatchIds,
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
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Capture")
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(
                isPresented: $isCaptureSessionPresented,
                onDismiss: {
                    store.endCaptureSession(id: captureSessionBatchId)
                    captureSessionBatchId = nil
                }
            ) {
                ClipCaptureSessionView(
                    activeMode: $store.activeCaptureMode,
                    isConnected: store.isConnected,
                    isRecognizingText: store.isRecognizingText,
                    latestPhoto: store.photos.first(where: { $0.source == .capture }),
                    ocrReviewImage: store.ocrReviewImage,
                    ocrTextRegions: store.ocrTextRegions,
                    statusText: captureStatusText,
                    onBarcodeScan: { scan in
                        store.handleBarcodeScan(scan)
                    },
                    onCaptureImage: { image, mode in
                        switch mode {
                        case .ocr:
                            Task { await store.recognizeText(in: image) }
                        case .barcode:
                            break
                        case .photo, .dictation:
                            Task { await store.capturePhoto(image, batchId: captureSessionBatchId) }
                        }
                    },
                    onSendLatest: {
                        guard let latest = store.photos.first(where: { $0.source == .capture }) else { return }
                        Task { await store.sendPhoto(latest) }
                    },
                    onSendRecognizedText: { text in
                        store.sendRecognizedText(text)
                    },
                    onClearOcrReview: {
                        store.clearOcrReview()
                    }
                )
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ScannerBottomActionAccessory(
                    title: "Start Capture",
                    systemImage: store.activeCaptureMode.symbolName,
                    isEnabled: store.isConnected,
                    isConnecting: store.isPairing,
                    statusText: captureStatusText,
                    disabledHint: store.targetHint,
                    action: {
                        guard store.isConnected else { return }
                        captureSessionBatchId = store.beginCaptureSession()
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
            "Ready to capture into Chrome"
        } else {
            store.targetHint
        }
    }
}

private struct ClipDictationView: View {
    @Bindable var store: ClipScannerStore
    let onScanQRCode: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ClipChromeSectionHeader(
                        title: "Dictate",
                        connection: connectionSummary,
                        onConnectionTapped: onScanQRCode
                    )

                    ClipDictationConnectionCard(
                        session: store.isConnected ? "Chrome" : "No Chrome session connected",
                        target: store.isConnected ? store.targetHint : "Connect to Chrome first"
                    )

                    ClipDictationTranscriptCard(
                        transcript: store.transcript,
                        isRecording: store.isDictating
                    )

                    if let error = store.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Dictate")
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ClipDictationStartAccessory(
                    isRecording: store.isDictating,
                    isConnected: store.isConnected,
                    isConnecting: store.isPairing,
                    statusText: dictationStatusText,
                    action: {
                        store.isDictating ? store.stopDictation() : store.startDictation()
                    }
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

    private var dictationStatusText: String {
        if store.isDictating {
            "Listening"
        } else if store.isPairing {
            store.statusText
        } else if store.isConnected {
            "Ready to dictate into Chrome"
        } else {
            store.targetHint
        }
    }
}

private struct ClipUploadView: View {
    @Bindable var store: ClipScannerStore
    let onScanQRCode: () -> Void
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var isPreparingUploads = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ClipChromeSectionHeader(
                        title: "Upload",
                        connection: connectionSummary,
                        onConnectionTapped: onScanQRCode
                    )

                    ClipRecentPhotosSection(
                        title: "Recent Uploads",
                        emptyTitle: "No Uploads Yet",
                        emptySystemImage: "photo.badge.plus",
                        emptyDescription: "Camera roll uploads will appear here after they are sent.",
                        photos: store.photos.filter { $0.source == .upload },
                        actionTitle: "Send"
                    ) { photo in
                        Task { await store.sendPhoto(photo) }
                    }
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
                Task {
                    isPreparingUploads = true
                    defer { isPreparingUploads = false }
                    var images: [UIImage] = []
                    for item in items {
                        guard let data = try? await item.loadTransferable(type: Data.self),
                              let image = UIImage(data: data) else { continue }
                        images.append(image)
                    }
                    await store.uploadPhotos(images)
                    pickerItems = []
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ScannerPhotoPickerAccessory(
                    selectedItems: $pickerItems,
                    isConnected: store.isConnected,
                    isPreparing: isPreparingUploads,
                    isConnecting: store.isPairing,
                    statusText: uploadStatusText,
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
        if isPreparingUploads {
            "Preparing uploads..."
        } else if store.isPairing {
            store.statusText
        } else if store.isConnected {
            "Ready to upload to Chrome"
        } else {
            store.targetHint
        }
    }
}

private struct ClipRecentPhotosSection: View {
    let title: String
    let emptyTitle: String
    let emptySystemImage: String
    let emptyDescription: String
    let photos: [ClipScannerStore.ClipPhoto]
    let actionTitle: String
    let onSend: (ClipScannerStore.ClipPhoto) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title)
                    .font(.headline)
                Spacer()
                Text("\(photos.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if photos.isEmpty {
                ContentUnavailableView(
                    emptyTitle,
                    systemImage: emptySystemImage,
                    description: Text(emptyDescription)
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 34)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                VStack(spacing: 10) {
                    ForEach(photos) { photo in
                        ClipPhotoRow(photo: photo, actionTitle: actionTitle) {
                            onSend(photo)
                        }
                    }
                }
            }
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
    let onToggleExpanded: () -> Void
    let onPreview: (ClipScannerStore.ClipPhoto) -> Void
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
            .accessibilityLabel(connection.isConnected ? connection.statusText : "Connect to Chrome")
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

private struct ClipConnectChoicesView: View {
    @Bindable var store: ClipScannerStore
    @Environment(\.dismiss) private var dismiss
    let onReconnect: () -> Void
    let onScanQRCode: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Label("Connect to Chrome", systemImage: "desktopcomputer")
                    .font(.title2.bold())
                    .foregroundStyle(.primary)

                if let displayName = store.lastSessionDisplayName {
                    Text("Reconnect to \(displayName), or scan a QR code for a different computer session.")
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
                    Text("Scan a Volt QR code from Chrome to connect this App Clip.")
                        .font(.body)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                VStack(spacing: 10) {
                    if store.lastSessionDisplayName != nil {
                        Button {
                            onReconnect()
                        } label: {
                            Label("Reconnect", systemImage: "arrow.clockwise")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 52)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                    }

                    Button {
                        onScanQRCode()
                    } label: {
                        Label("Scan QR", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.bordered)
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
                    title: "Computer",
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
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        onScanQRCode()
                    } label: {
                        Label("Scan QR", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 52)
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

                Text(store.pairingFailureMessage ?? "The App Clip could not connect to the Chrome session.")
                    .font(.body)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Retry can help if Chrome or the network was slow. If the QR expired or opened the wrong session, scan a fresh Volt QR code.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)

                VStack(spacing: 10) {
                    Button {
                        store.retryPairing()
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(!store.canRetryPairing)

                    Button {
                        onScanQRCode()
                    } label: {
                        Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.bordered)
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

private struct ClipDictationConnectionCard: View {
    let session: String
    let target: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Chrome Session", systemImage: "desktopcomputer")
                .font(.headline)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                ClipDetailRow(title: "Session", value: session, systemImage: "desktopcomputer")
                ClipDetailRow(title: "Typing Into", value: target, systemImage: "cursorarrow")
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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

private struct ClipDictationTranscriptCard: View {
    let transcript: String
    let isRecording: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(isRecording ? "Listening" : "Transcript", systemImage: isRecording ? "waveform" : "text.quote")
                .font(.headline)

            Text(transcript.isEmpty ? "Dictated text will appear here while you speak." : transcript)
                .font(.title3)
                .foregroundStyle(transcript.isEmpty ? .secondary : .primary)
                .frame(maxWidth: .infinity, minHeight: 160, alignment: .topLeading)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct ClipDictationStartAccessory: View {
    let isRecording: Bool
    let isConnected: Bool
    let isConnecting: Bool
    let statusText: String
    let action: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text(statusText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)

            Button(action: action) {
                Label(buttonTitle, systemImage: buttonSystemImage)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(buttonColor, in: RoundedRectangle(cornerRadius: ScannerTabLayout.primaryActionCornerRadius, style: .continuous))
                    .opacity(isConnected || isRecording || isConnecting ? 1 : ScannerTabLayout.disabledPrimaryActionOpacity)
            }
            .buttonStyle(.plain)
            .disabled((!isConnected && !isRecording) || isConnecting)
            .accessibilityHint(isConnected || isRecording ? "" : "Connect to Chrome before dictating")
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
    }

    private var buttonTitle: String {
        if isConnecting {
            return "Connecting..."
        }
        return isRecording ? "Stop Dictation" : "Start Dictation"
    }

    private var buttonSystemImage: String {
        if isConnecting {
            return "hourglass"
        }
        return isRecording ? "stop.fill" : "mic.fill"
    }

    private var buttonColor: Color {
        if isConnecting {
            .gray
        } else if isRecording {
            .red
        } else if isConnected {
            .green
        } else {
            .gray
        }
    }
}

private struct ClipCaptureSessionView: View {
    @Binding var activeMode: CaptureMode
    let isConnected: Bool
    let isRecognizingText: Bool
    let latestPhoto: ClipScannerStore.ClipPhoto?
    let ocrReviewImage: UIImage?
    let ocrTextRegions: [RecognizedTextRegion]
    let statusText: String
    let onBarcodeScan: (ClipBarcodeScan) -> Void
    let onCaptureImage: (UIImage, CaptureMode) -> Void
    let onSendLatest: () -> Void
    let onSendRecognizedText: (String) -> Void
    let onClearOcrReview: () -> Void

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
    private let topToolbarTopPadding: CGFloat = 12
    private let topToolbarHeight: CGFloat = 42
    private let photoPreviewToolbarGap: CGFloat = 0

    var body: some View {
        ZStack {
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
                        barcodeHint: detectedBarcodeBounds == nil ? "Point camera at barcode" : "Barcode found",
                        hasLatestCapture: false,
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
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: selectedTextRegion?.id)
        .onAppear {
            activeMode = .ocr
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
                cameraService.setLiveTextScanningEnabled(activeMode == .ocr && ocrReviewImage == nil)
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
            cameraService.setLiveTextScanningEnabled(mode == .ocr && ocrReviewImage == nil)
            if mode != .barcode {
                cameraService.clearDetectedBarcode()
            }
        }
        .onChange(of: ocrReviewImage != nil) { _, isReviewing in
            cameraService.setLiveTextScanningEnabled(activeMode == .ocr && !isReviewing)
            if isReviewing {
                selectedTextRegion = nil
                selectedCleanedText = nil
                cameraService.setTorchEnabled(false)
            }
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
        captureNotice = mode == .ocr ? "Capturing text image" : nil

        Task {
            do {
                let image = try await cameraService.capturePhoto()
                onCaptureImage(image, mode)
                captureNotice = successNotice(for: mode)
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

private struct ClipPhotoRow: View {
    let photo: ClipScannerStore.ClipPhoto
    let actionTitle: String
    let action: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(uiImage: photo.image)
                .resizable()
                .scaledToFill()
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                Text("Product photo")
                    .font(.headline)
                Text(photo.status)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button(actionTitle, systemImage: "paperplane.fill", action: action)
                .buttonStyle(.bordered)
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct ClipWebRTCBridgeView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView {
        webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
