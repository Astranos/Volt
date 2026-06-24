@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit
import WebKit

struct ClipRootView: View {
    @Bindable var store: ClipScannerStore
    @State private var isPairingFailurePresented = false
    @State private var isPairingScannerPresented = false

    var body: some View {
        ZStack {
            TabView(selection: $store.selectedTab) {
                ClipCaptureView(store: store)
                    .tabItem { Label("Capture", systemImage: "camera.viewfinder") }
                    .tag(ClipScannerStore.ClipTab.capture)

                ClipDictationView(store: store)
                    .tabItem { Label("Dictate", systemImage: "mic") }
                    .tag(ClipScannerStore.ClipTab.dictate)

                ClipUploadView(store: store)
                    .tabItem { Label("Upload", systemImage: "square.and.arrow.up") }
                    .tag(ClipScannerStore.ClipTab.upload)
            }

            ClipWebRTCBridgeView(webView: store.bridgeWebView)
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .allowsHitTesting(false)
        }
        .sheet(isPresented: $isPairingFailurePresented) {
            ClipPairingFailureView(
                store: store,
                onScanQRCode: {
                    isPairingFailurePresented = false
                    isPairingScannerPresented = true
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
    }
}

private struct ClipCaptureView: View {
    @Bindable var store: ClipScannerStore
    @State private var isCaptureSessionPresented = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ClipChromeSectionHeader(
                        title: "Capture",
                        connection: connectionSummary
                    )

                    ClipRecentPhotosSection(
                        title: "Previously Captured",
                        emptyTitle: "No Captures Yet",
                        emptySystemImage: "doc.text.magnifyingglass",
                        emptyDescription: "Finished captures will show here after you leave the camera session.",
                        photos: store.photos.filter { $0.source == .capture },
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
            .navigationTitle("Capture")
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $isCaptureSessionPresented) {
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
                            Task { await store.capturePhoto(image) }
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
                    isEnabled: true,
                    statusText: captureStatusText,
                    disabledHint: store.targetHint,
                    action: {
                        isCaptureSessionPresented = true
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

    private var captureStatusText: String {
        if store.isConnected {
            "Ready to capture into Chrome"
        } else {
            "Capture locally. Connect to Chrome to send."
        }
    }
}

private struct ClipDictationView: View {
    @Bindable var store: ClipScannerStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ClipChromeSectionHeader(
                        title: "Dictate",
                        connection: connectionSummary
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
        } else if store.isConnected {
            "Ready to dictate into Chrome"
        } else {
            store.targetHint
        }
    }
}

private struct ClipUploadView: View {
    @Bindable var store: ClipScannerStore
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var isPreparingUploads = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ClipChromeSectionHeader(
                        title: "Upload",
                        connection: connectionSummary
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

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title)
                .font(.largeTitle.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .frame(maxWidth: .infinity, alignment: .leading)

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
            .accessibilityElement(children: .combine)
            .accessibilityLabel(connection.statusText)
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
        return connection.isBusy ? .orange : .secondary
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
                Label(isRecording ? "Stop Dictation" : "Start Dictation", systemImage: isRecording ? "stop.fill" : "mic.fill")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(buttonColor, in: RoundedRectangle(cornerRadius: ScannerTabLayout.primaryActionCornerRadius, style: .continuous))
                    .opacity(isConnected || isRecording ? 1 : ScannerTabLayout.disabledPrimaryActionOpacity)
            }
            .buttonStyle(.plain)
            .accessibilityHint(isConnected || isRecording ? "" : "Connect to Chrome before dictating")
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
    }

    private var buttonColor: Color {
        if isRecording {
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
    @State private var focusPoint: CGPoint?
    @State private var cameraStateRevision = 0

    var body: some View {
        ZStack {
            if let ocrReviewImage {
                OcrReviewLayer(
                    image: ocrReviewImage,
                    regions: ocrTextRegions,
                    selectedRegion: selectedTextRegion,
                    imageContentMode: .fit,
                    fillFocusX: 0.5,
                    onSelectRegion: { selectedTextRegion = $0 }
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
                    onPinch: { scale in
                        cameraService.scaleZoom(by: scale)
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
                        .frame(minHeight: 42)
                        .background(.black.opacity(0.48), in: Capsule())

                    Spacer()

                    Button {
                        onClearOcrReview()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 42, height: 42)
                            .background(.black.opacity(0.48), in: Circle())
                    }
                    .accessibilityLabel("End session")
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)

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

                Spacer()
            }

            if let selectedTextRegion {
                ClipExtractedTextActionCard(
                    text: selectedTextRegion.text,
                    onSend: {
                        onSendRecognizedText(selectedTextRegion.text)
                        self.selectedTextRegion = nil
                    },
                    onDismiss: {
                        self.selectedTextRegion = nil
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
                        onClearOcrReview()
                    },
                    onFinish: {
                        selectedTextRegion = nil
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
                        isCaptureEnabled: !isCapturingPhoto && !isRecognizingText,
                        barcodeHint: detectedBarcodeBounds == nil ? "Point camera at barcode" : "Barcode found",
                        hasLatestCapture: latestPhoto != nil,
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
                        onSendLatest: onSendLatest,
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
            }
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
        captureNotice = mode == .ocr ? "Capturing text image" : "Capturing photo"

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

    private func successNotice(for mode: CaptureMode) -> String {
        switch mode {
        case .ocr:
            "Text image captured"
        case .barcode:
            "Photo captured; live barcode scans send automatically"
        case .photo, .dictation:
            "Photo saved"
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
}

private struct ClipCaptureSessionBackdrop: View {
    let cameraService: ClipBarcodeScannerService
    let activeMode: CaptureMode
    let gridVisible: Bool
    let detectedBarcodeBounds: CGRect?
    let detectedBarcodeFormat: String?
    let focusPoint: CGPoint?
    let onTap: (CGPoint, CGPoint) -> Void
    let onPinch: (CGFloat) -> Void
    private let photoTopClearance: CGFloat = 78
    private let photoControlsReservedHeight: CGFloat = 430

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                Color.black
                    .ignoresSafeArea()

                if activeMode == .photo {
                    photoPreview(in: geometry)
                } else {
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
                                ClipFocusReticle()
                                    .position(focusPoint)
                                    .allowsHitTesting(false)
                            }
                        }
                }
            }
        }
    }

    private func photoPreview(in geometry: GeometryProxy) -> some View {
        let topInset = geometry.safeAreaInsets.top + photoTopClearance
        let bottomInset = geometry.safeAreaInsets.bottom
        let availableHeight = max(0, geometry.size.height - topInset - bottomInset - photoControlsReservedHeight)
        let side = min(geometry.size.width - 24, availableHeight)
        let topOffset = topInset

        return ClipCameraPreview(service: cameraService, onTap: onTap, onPinch: onPinch)
            .frame(width: side, height: side)
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
                    ClipFocusReticle()
                        .position(focusPoint)
                        .allowsHitTesting(false)
                }
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, topOffset)
    }
}

private struct ClipCameraPreview: UIViewRepresentable {
    let service: ClipBarcodeScannerService
    let onTap: (CGPoint, CGPoint) -> Void
    let onPinch: (CGFloat) -> Void

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
        var onPinch: ((CGFloat) -> Void)?

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
            guard recognizer.state == .began || recognizer.state == .changed else { return }
            onPinch?(recognizer.scale)
            recognizer.scale = 1
        }
    }
}

private struct ClipFocusReticle: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .stroke(.yellow, lineWidth: 2)
            .frame(width: 74, height: 74)
            .overlay {
                Circle()
                    .fill(.yellow)
                    .frame(width: 8, height: 8)
            }
            .transition(.scale.combined(with: .opacity))
    }
}

private struct ClipExtractedTextActionCard: View {
    let text: String
    let onSend: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Extracted Text")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.black)

                    Text(text)
                        .font(.title3)
                        .foregroundStyle(.black.opacity(0.62))
                        .lineLimit(3)
                        .minimumScaleFactor(0.78)
                }

                Spacer(minLength: 0)

                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.black.opacity(0.68))
                        .frame(width: 34, height: 34)
                        .background(.black.opacity(0.1), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }

            Button(action: onSend) {
                Label("Send", systemImage: "paperplane.fill")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 64)
                    .background(Color.green, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 28)
        .frame(width: 340)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 36, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 36, style: .continuous)
                .stroke(.white.opacity(0.42), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.22), radius: 28, y: 16)
        .accessibilityElement(children: .contain)
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
