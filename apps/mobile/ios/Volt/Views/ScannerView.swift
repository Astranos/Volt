import SwiftUI

struct ScannerView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isCaptureSessionPresented = false
    @State private var isPairingScannerPresented = false
    let showsCameraLayer: Bool

    init(showsCameraLayer: Bool = true) {
        self.showsCameraLayer = showsCameraLayer
    }

    private var captureResults: [ScanResult] {
        store.results.filter { $0.source == .capture }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ScannerSectionHeader(title: "Capture") {
                        isPairingScannerPresented = true
                    }

                    previousCaptures
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Capture")
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $isCaptureSessionPresented) {
                CaptureSessionView(isPresented: $isCaptureSessionPresented)
            }
            .fullScreenCover(isPresented: $isPairingScannerPresented) {
                PairingScanSessionView(isPresented: $isPairingScannerPresented)
            }
            .onAppear {
                store.activeMode = .ocr
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                CaptureStartAccessory(
                    isConnected: store.connectionStatus.isConnected,
                    statusText: captureStatusText,
                    targetHint: store.targetHint,
                    onStart: startCapture
                )
            }
        }
    }

    private var captureStatusText: String {
        if store.connectionStatus.isConnected {
            "Ready to capture into Chrome"
        } else {
            store.targetHint
        }
    }

    private func startCapture() {
        guard store.connectionStatus.isConnected else { return }
        store.clearOcrReview()
        store.activeMode = .ocr
        isCaptureSessionPresented = true
    }

    private var previousCaptures: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Previously Captured")
                    .font(.headline)
                Spacer()
                Text("\(captureResults.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if captureResults.isEmpty {
                ContentUnavailableView(
                    "No Captures Yet",
                    systemImage: "doc.text.magnifyingglass",
                    description: Text("Finished captures will show here after you leave the camera session.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 34)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                VStack(spacing: 10) {
                    ForEach(captureResults) { result in
                        CapturedResultRow(
                            result: result,
                            canResend: store.connectionStatus.isConnected,
                            onResend: {
                                Task { await store.resendResultToChrome(id: result.id) }
                            },
                            onDelete: {
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

}

private struct CaptureStartAccessory: View {
    let isConnected: Bool
    let statusText: String
    let targetHint: String
    let onStart: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text(statusText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)

            Button(action: onStart) {
                Label("Start Capture", systemImage: "doc.viewfinder")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(
                        ScannerTabLayout.primaryActionBackground(isEnabled: isConnected),
                        in: RoundedRectangle(cornerRadius: ScannerTabLayout.primaryActionCornerRadius, style: .continuous)
                    )
                    .opacity(isConnected ? 1 : ScannerTabLayout.disabledPrimaryActionOpacity)
            }
            .buttonStyle(.plain)
            .disabled(!isConnected)
            .accessibilityHint(isConnected ? "Opens the camera capture session." : targetHint)
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
    }
}

struct CaptureSessionView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var isPresented: Bool
    @State private var gridVisible = true
    @State private var selectedTextRegion: RecognizedTextRegion?

    var body: some View {
        @Bindable var store = store

        ZStack {
            if let reviewImage = store.ocrReviewImage {
                OcrReviewLayer(
                    image: reviewImage,
                    regions: store.ocrTextRegions,
                    selectedRegion: selectedTextRegion,
                    onSelectRegion: { selectedTextRegion = $0 }
                )
                    .ignoresSafeArea()
            } else {
                ScannerCameraLayer(gridVisible: gridVisible)
                    .ignoresSafeArea()
            }

        }
        .background(.black)
        .safeAreaInset(edge: .top, spacing: 0) {
            if store.ocrReviewImage == nil {
                CameraSessionHeader(onFinish: {
                    store.clearOcrReview()
                    isPresented = false
                })
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if store.ocrReviewImage != nil {
                OcrReviewControls(
                    regionCount: store.ocrTextRegions.count,
                    onRetake: {
                        selectedTextRegion = nil
                        store.clearOcrReview()
                    },
                    onFinish: {
                        selectedTextRegion = nil
                        store.clearOcrReview()
                        isPresented = false
                    }
                )
            } else {
                CameraSessionControls(
                    activeMode: $store.activeMode,
                    torchEnabled: store.camera.torchEnabled,
                    zoomLabel: store.camera.zoomDisplayLabel,
                    gridVisible: gridVisible,
                    isRecognizingText: store.isRecognizingText,
                    onToggleTorch: {
                        store.camera.setTorchEnabled(!store.camera.torchEnabled)
                    },
                    onZoomOut: {
                        store.camera.adjustZoom(by: -0.25)
                    },
                    onZoomIn: {
                        store.camera.adjustZoom(by: 0.25)
                    },
                    onToggleGrid: {
                        gridVisible.toggle()
                    },
                    onCapture: {
                        Task { await store.capture() }
                    }
                )
            }
        }
        .confirmationDialog(
            "Extracted Text",
            isPresented: Binding(
                get: { selectedTextRegion != nil },
                set: { isPresented in
                    if !isPresented {
                        selectedTextRegion = nil
                    }
                }
            ),
            titleVisibility: .visible
        ) {
            Button("Send", systemImage: "paperplane.fill") {
                guard let selectedTextRegion else { return }
                store.sendRecognizedText(selectedTextRegion.text)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(selectedTextRegion?.text ?? "")
        }
        .onAppear {
            store.activeMode = .ocr
            syncCameraForOcrReview(isReviewingOcr: store.ocrReviewImage != nil)
        }
        .onChange(of: store.ocrReviewImage != nil) { _, isReviewingOcr in
            syncCameraForOcrReview(isReviewingOcr: isReviewingOcr)
        }
        .onChange(of: store.connectionStatus) { _, status in
            guard !status.isConnected else { return }
            selectedTextRegion = nil
            store.clearOcrReview()
            isPresented = false
        }
        .onDisappear {
            store.camera.stop()
        }
    }

    private func syncCameraForOcrReview(isReviewingOcr: Bool) {
        if isReviewingOcr {
            store.camera.stop()
        } else {
            store.camera.start()
        }
    }
}

struct CameraSessionControls: View {
    @Binding var activeMode: CaptureMode
    let torchEnabled: Bool
    let zoomLabel: String
    let gridVisible: Bool
    let isRecognizingText: Bool
    let onToggleTorch: () -> Void
    let onZoomOut: () -> Void
    let onZoomIn: () -> Void
    let onToggleGrid: () -> Void
    let onCapture: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            cameraToolsRow

            Text(captureHint)
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)

            ZStack {
                HStack {
                    Color.clear
                        .frame(width: 88, height: 48)

                    Spacer()

                    trailingSlot
                }

                shutterButton
            }
            .frame(height: 96)

            Picker("Capture mode", selection: $activeMode) {
                Text("Text").tag(CaptureMode.ocr)
                Text("Barcodes").tag(CaptureMode.barcode)
                Text("Photos").tag(CaptureMode.photo)
            }
            .pickerStyle(.segmented)
            .controlSize(.large)
            .tint(.green)
            .colorScheme(.light)
            .padding(4)
            .frame(maxWidth: 360)
            .background(.white.opacity(0.92), in: Capsule())
            .overlay {
                Capsule().stroke(.white.opacity(0.35), lineWidth: 1)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 22)
        .background {
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.78), .black.opacity(0.94)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        }
    }

    private var cameraToolsRow: some View {
        HStack {
            SessionIconButton(
                systemImage: torchEnabled ? "bolt.fill" : "bolt.slash",
                isActive: torchEnabled,
                label: torchEnabled ? "Turn flash off" : "Turn flash on",
                action: onToggleTorch
            )

            Spacer()

            HStack(spacing: 8) {
                SessionIconButton(systemImage: "minus.magnifyingglass", label: "Zoom out", action: onZoomOut)
                Text(zoomLabel)
                    .font(.subheadline.monospacedDigit().bold())
                    .foregroundStyle(.white)
                    .frame(minWidth: 58)
                SessionIconButton(systemImage: "plus.magnifyingglass", label: "Zoom in", action: onZoomIn)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 56)
            .background(.black.opacity(0.54), in: Capsule())
            .overlay {
                Capsule().stroke(.white.opacity(0.14), lineWidth: 1)
            }

            Spacer()

            rightToolSlot
        }
    }

    private var rightToolSlot: some View {
        Group {
            if activeMode == .photo {
                SessionIconButton(
                    systemImage: gridVisible ? "grid" : "square",
                    isActive: gridVisible,
                    label: gridVisible ? "Hide grid lines" : "Show grid lines",
                    action: onToggleGrid
                )
            } else {
                Color.clear
                    .frame(width: 52, height: 52)
            }
        }
    }

    private var trailingSlot: some View {
        Color.clear
            .frame(width: 88, height: 48)
    }

    private var captureHint: String {
        switch activeMode {
        case .ocr:
            "Hold document in frame"
        case .barcode:
            "Center barcode in frame"
        case .photo:
            "Frame photo"
        case .dictation:
            "Capture"
        }
    }

    private var shutterSymbol: String {
        if isRecognizingText {
            return "hourglass"
        }
        switch activeMode {
        case .ocr:
            return "doc.viewfinder"
        case .barcode:
            return "barcode.viewfinder"
        case .photo:
            return "camera.viewfinder"
        case .dictation:
            return "doc.viewfinder"
        }
    }

    private var shutterAccessibilityLabel: String {
        if isRecognizingText {
            return "Capturing document"
        }
        switch activeMode {
        case .ocr:
            return "Capture text"
        case .barcode:
            return "Capture barcode"
        case .photo:
            return "Capture photo"
        case .dictation:
            return "Capture"
        }
    }

    private var shutterButton: some View {
        Button(action: onCapture) {
            ZStack {
                Circle()
                    .fill(.white)
                    .frame(width: 78, height: 78)
                Circle()
                    .stroke(.white.opacity(0.52), lineWidth: 4)
                    .frame(width: 92, height: 92)
                Image(systemName: shutterSymbol)
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(.black)
            }
        }
        .disabled(isRecognizingText)
        .accessibilityLabel(shutterAccessibilityLabel)
    }
}

struct CameraSessionHeader: View {
    let onFinish: () -> Void

    var body: some View {
        HStack {
            Spacer()

            Button("End session", systemImage: "xmark", action: onFinish)
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(.black.opacity(0.58), in: Capsule())
                .overlay {
                    Capsule().stroke(.white.opacity(0.14), lineWidth: 1)
                }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background {
            LinearGradient(
                colors: [.black.opacity(0.72), .black.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .top)
        }
    }
}

struct SessionIconButton: View {
    let systemImage: String
    var isActive = false
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(isActive ? .yellow : .white)
                .frame(width: 44, height: 44)
                .background(.black.opacity(0.52), in: Circle())
                .overlay {
                    Circle().stroke(.white.opacity(0.12), lineWidth: 1)
                }
        }
        .accessibilityLabel(label)
    }
}

struct ScannerCameraLayer: View {
    @Environment(ScannerStore.self) private var store
    @State private var focusPoint: CGPoint?
    var gridVisible = false
    var guideVisible = true
    var barcodeDetectionLabel: String?
    private let photoHeaderClearance: CGFloat = 48
    private let photoControlsReservedHeight: CGFloat = 318

    var body: some View {
        Group {
            if store.camera.authorizationStatus == .authorized {
                GeometryReader { proxy in
                    ZStack(alignment: .top) {
                        Color.black
                            .ignoresSafeArea()

                        if store.activeMode == .photo {
                            photoPreview(in: proxy)
                        } else {
                            cameraPreview
                                .ignoresSafeArea()
                                .overlay(alignment: .center) {
                                    if guideVisible {
                                        CaptureGuideOverlay(mode: store.activeMode, gridVisible: gridVisible)
                                            .allowsHitTesting(false)
                                    }
                                }
                        }
                    }
                }
            } else {
                ContentUnavailableView(
                    "Camera Access Required",
                    systemImage: "camera",
                    description: Text("Enable camera access to capture documents.")
                )
            }
        }
    }

    private var cameraPreview: some View {
        CameraPreview(
            previewLayer: store.camera.previewLayer,
            onTap: { devicePoint, layerPoint in
                focusPoint = layerPoint
                store.camera.focus(at: devicePoint)
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
                store.camera.scaleZoom(by: scale)
            }
        )
        .overlay(alignment: .topLeading) {
            if let focusPoint {
                FocusReticle()
                    .position(focusPoint)
                    .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .topLeading) {
            if let barcodeBounds = store.camera.detectedBarcodeBounds,
               barcodeBounds.width > 0,
               barcodeBounds.height > 0 {
                BarcodeDetectionReticle(
                    bounds: barcodeBounds,
                    format: store.camera.detectedBarcodeFormat,
                    labelOverride: barcodeDetectionLabel
                )
                    .allowsHitTesting(false)
            }
        }
    }

    private func photoPreview(in proxy: GeometryProxy) -> some View {
        let topInset = proxy.safeAreaInsets.top + photoHeaderClearance
        let bottomInset = proxy.safeAreaInsets.bottom
        let availableHeight = max(0, proxy.size.height - topInset - bottomInset - photoControlsReservedHeight)
        let side = min(proxy.size.width, availableHeight)
        let topOffset = topInset + max(0, (availableHeight - side) / 2)

        return cameraPreview
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
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, topOffset)
    }
}

struct FocusReticle: View {
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

struct BarcodeDetectionReticle: View {
    let bounds: CGRect
    let format: String?
    let labelOverride: String?

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(.green, lineWidth: 3)
                .shadow(color: .black.opacity(0.42), radius: 3, y: 1)

            Text(label)
                .font(.caption2.weight(.bold))
                .foregroundStyle(.black)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.green, in: Capsule())
                .offset(x: 8, y: -28)
        }
        .frame(width: max(42, bounds.width), height: max(42, bounds.height))
        .position(x: bounds.midX, y: bounds.midY)
        .transition(.opacity.combined(with: .scale(scale: 0.96)))
        .animation(.easeOut(duration: 0.12), value: bounds)
        .accessibilityHidden(true)
    }

    private var label: String {
        if let labelOverride, !labelOverride.isEmpty {
            return labelOverride
        }
        guard let format else { return "Code" }
        return format.localizedCaseInsensitiveContains("qr") ? "QR found" : "Code found"
    }
}

struct CapturedResultRow: View {
    let result: ScanResult
    let canResend: Bool
    let onResend: () -> Void
    var onDelete: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            preview

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Spacer(minLength: 0)
                    DeliveryBadge(state: result.deliveryState)
                }

                resultContent

                HStack(spacing: 8) {
                    Label(result.format, systemImage: "info.circle")
                    Text(result.capturedAt, format: .dateTime.hour().minute())
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            VStack(spacing: 6) {
                Button(action: onResend) {
                    Label("Resend \(title) to Chrome", systemImage: result.deliveryState == .sending ? "hourglass" : "paperplane")
                        .labelStyle(.iconOnly)
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless)
                .disabled(!canResend || result.deliveryState == .sending)

                if let onDelete {
                    Button(role: .destructive, action: onDelete) {
                        Label("Delete \(title)", systemImage: "trash")
                            .labelStyle(.iconOnly)
                            .font(.system(size: 16, weight: .semibold))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.borderless)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button(action: onResend) {
                Label("Resend", systemImage: "paperplane")
            }
            .tint(.green)
            .disabled(!canResend || result.deliveryState == .sending)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if let onDelete {
                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }

    @ViewBuilder
    private var preview: some View {
        if result.kind == .photo, let imageData = result.imageData, UIImage(data: imageData) != nil {
            EmptyView()
        } else {
            Image(systemName: symbol)
                .font(.title3.weight(.semibold))
                .foregroundStyle(iconColor)
                .frame(width: 44, height: 44)
                .background(iconColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    @ViewBuilder
    private var resultContent: some View {
        if result.kind == .photo, let imageData = result.imageData, let image = UIImage(data: imageData) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(maxWidth: 180)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(.quaternary, lineWidth: 1)
                }
        } else {
            Text(primaryText)
                .font(result.kind == .barcode ? .callout.monospaced() : .callout)
                .foregroundStyle(.primary)
                .lineLimit(4)
                .textSelection(.enabled)
        }
    }

    private var primaryText: String {
        switch result.kind {
        case .photo:
            result.imageData == nil ? "Photo preview unavailable" : result.value
        default:
            result.value
        }
    }

    private var title: String {
        switch result.kind {
        case .barcode: "Barcode"
        case .text: "Document Text"
        case .photo: "Photo"
        case .dictation: "Dictation"
        }
    }

    private var iconColor: Color {
        switch result.kind {
        case .barcode: .green
        case .text: .green
        case .photo: .purple
        case .dictation: .orange
        }
    }

    private var symbol: String {
        switch result.kind {
        case .barcode: "barcode"
        case .text: "doc.text"
        case .photo: "photo"
        case .dictation: "mic"
        }
    }

}

struct CaptureDock: View {
    let statusText: String
    let targetHint: String
    let resultCount: Int
    let latestResult: ScanResult?
    let isRecognizingText: Bool
    let onCapture: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            if let latestResult {
                LatestCaptureStrip(result: latestResult, count: resultCount)
            }

            HStack(spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(statusText)
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text(targetHint)
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                Button(action: onCapture) {
                    ZStack {
                        Circle()
                            .fill(.white)
                            .frame(width: 76, height: 76)
                        Circle()
                            .stroke(.white.opacity(0.55), lineWidth: 4)
                            .frame(width: 88, height: 88)
                        Image(systemName: isRecognizingText ? "hourglass" : "doc.viewfinder")
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundStyle(.black)
                    }
                }
                .disabled(isRecognizingText)
                .accessibilityLabel(isRecognizingText ? "Capturing document" : "Start capture")
            }
            .padding(18)
            .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(.white.opacity(0.12), lineWidth: 1)
            }
        }
        .padding(.horizontal, 18)
    }
}

struct ReviewCaptureDock: View {
    let statusText: String
    @Binding var text: String
    let onRetake: () -> Void
    let onSend: () -> Void

    private var hasText: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(statusText, systemImage: "doc.text.viewfinder")
                    .font(.headline)
                    .foregroundStyle(.white)
                Spacer()
                Text("\(text.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.55))
            }

            TextEditor(text: $text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .foregroundStyle(.white)
                .frame(height: 112)
                .padding(10)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(.white.opacity(0.1), lineWidth: 1)
                }

            HStack(spacing: 10) {
                Button("Retake", systemImage: "arrow.clockwise", action: onRetake)
                    .buttonStyle(.bordered)
                    .tint(.white)

                Button("Send", systemImage: "paperplane.fill", action: onSend)
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(!hasText)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(16)
        .background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(.white.opacity(0.12), lineWidth: 1)
        }
        .padding(.horizontal, 18)
    }
}

struct LatestCaptureStrip: View {
    let result: ScanResult
    let count: Int

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.text")
                .foregroundStyle(.white)
            Text(result.value)
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.82))
                .lineLimit(1)
            Spacer(minLength: 0)
            Text("\(count)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.white.opacity(0.64))
        }
        .padding(.horizontal, 14)
        .frame(height: 42)
        .background(.black.opacity(0.54), in: Capsule())
        .overlay {
            Capsule().stroke(.white.opacity(0.1), lineWidth: 1)
        }
    }
}

struct OcrReviewControls: View {
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
                        .background(.black.opacity(0.54), in: Capsule())
                }

                Spacer()

                Label("\(regionCount)", systemImage: "text.viewfinder")
                    .font(.subheadline.monospacedDigit().bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 48)
                    .background(.black.opacity(0.54), in: Capsule())
                    .overlay {
                        Capsule().stroke(.white.opacity(0.14), lineWidth: 1)
                    }
                    .accessibilityLabel("\(regionCount) recognized text regions")

                Spacer()

                Button(action: onFinish) {
                    Label("Finish", systemImage: "checkmark")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .frame(minWidth: 104, minHeight: 48)
                        .background(.black.opacity(0.54), in: Capsule())
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 22)
        .background {
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.78), .black.opacity(0.94)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        }
    }
}

struct OcrReviewLayer: View {
    let image: UIImage
    let regions: [RecognizedTextRegion]
    let selectedRegion: RecognizedTextRegion?
    let onSelectRegion: (RecognizedTextRegion) -> Void
    @State private var baseScale: CGFloat = 1
    @State private var gestureScale: CGFloat = 1
    @State private var baseOffset: CGSize = .zero
    @State private var gestureOffset: CGSize = .zero

    private var currentScale: CGFloat {
        min(max(baseScale * gestureScale, 1), 4)
    }

    private var currentOffset: CGSize {
        currentScale > 1
            ? CGSize(width: baseOffset.width + gestureOffset.width, height: baseOffset.height + gestureOffset.height)
            : .zero
    }

    var body: some View {
        GeometryReader { proxy in
            let imageRect = aspectFitRect(for: image.size, in: proxy.size)

            ZStack {
                Color.black

                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                ForEach(regions) { region in
                    let rect = viewRect(for: region.boundingBox, in: imageRect)

                    Button {
                        onSelectRegion(region)
                    } label: {
                        RoundedRectangle(cornerRadius: max(4, min(rect.height * 0.22, 10)), style: .continuous)
                            .fill(fillStyle(for: region))
                            .overlay {
                                RoundedRectangle(cornerRadius: max(4, min(rect.height * 0.22, 10)), style: .continuous)
                                    .stroke(strokeStyle(for: region), lineWidth: 1.5)
                            }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .frame(width: max(rect.width, 28), height: max(rect.height, 28))
                    .position(x: rect.midX, y: rect.midY)
                    .accessibilityLabel(region.text)
                    .accessibilityHint("Copy or send recognized text")
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .scaleEffect(currentScale)
            .offset(currentOffset)
            .simultaneousGesture(magnificationGesture)
            .simultaneousGesture(dragGesture)
        }
    }

    private var magnificationGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                gestureScale = value
            }
            .onEnded { value in
                baseScale = min(max(baseScale * value, 1), 4)
                gestureScale = 1
                if baseScale == 1 {
                    baseOffset = .zero
                    gestureOffset = .zero
                }
            }
    }

    private var dragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                guard currentScale > 1 else { return }
                gestureOffset = value.translation
            }
            .onEnded { value in
                guard currentScale > 1 else {
                    baseOffset = .zero
                    gestureOffset = .zero
                    return
                }
                baseOffset = CGSize(
                    width: baseOffset.width + value.translation.width,
                    height: baseOffset.height + value.translation.height
                )
                gestureOffset = .zero
            }
    }

    private func fillStyle(for region: RecognizedTextRegion) -> Color {
        selectedRegion?.id == region.id ? .green.opacity(0.34) : .yellow.opacity(0.24)
    }

    private func strokeStyle(for region: RecognizedTextRegion) -> Color {
        selectedRegion?.id == region.id ? .green.opacity(0.92) : .yellow.opacity(0.9)
    }

    private func aspectFitRect(for imageSize: CGSize, in containerSize: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, containerSize.width > 0, containerSize.height > 0 else {
            return .zero
        }

        let scale = min(containerSize.width / imageSize.width, containerSize.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(
            x: (containerSize.width - size.width) / 2,
            y: (containerSize.height - size.height) / 2,
            width: size.width,
            height: size.height
        )
    }

    private func viewRect(for normalizedRect: CGRect, in imageRect: CGRect) -> CGRect {
        CGRect(
            x: imageRect.minX + normalizedRect.minX * imageRect.width,
            y: imageRect.minY + (1 - normalizedRect.maxY) * imageRect.height,
            width: normalizedRect.width * imageRect.width,
            height: normalizedRect.height * imageRect.height
        ).insetBy(dx: -3, dy: -3)
    }
}

struct CaptureGuideOverlay: View {
    let mode: CaptureMode
    var gridVisible = false

    var body: some View {
        GeometryReader { proxy in
            let targetZone = captureTargetZone(in: proxy)
            let guideSize = guideSize(for: mode, in: targetZone, screenWidth: proxy.size.width)

            ZStack {
                switch mode {
                case .barcode:
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(.green, lineWidth: 3)
                        .frame(width: guideSize.width, height: guideSize.height)
                        .overlay {
                            Rectangle()
                                .fill(.green.opacity(0.75))
                                .frame(height: 2)
                                .padding(.horizontal, 16)
                        }
                        .position(x: targetZone.midX, y: targetZone.midY)
                case .photo:
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(.white.opacity(0.72), lineWidth: 1.2)
                        .background(.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 24))
                        .frame(width: guideSize.width, height: guideSize.height)
                        .overlay {
                            if gridVisible {
                                SquareGrid()
                                    .clipShape(RoundedRectangle(cornerRadius: 24))
                                    .frame(width: guideSize.width, height: guideSize.height)
                            }
                        }
                        .position(x: targetZone.midX, y: targetZone.midY)
                case .ocr:
                    EmptyView()
                case .dictation:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .allowsHitTesting(false)
    }

    private func captureTargetZone(in proxy: GeometryProxy) -> CGRect {
        let topInset = proxy.safeAreaInsets.top
        let bottomInset = proxy.safeAreaInsets.bottom
        let top = topInset + 88
        let reservedControlsHeight: CGFloat = 318 + bottomInset
        let bottom = max(top + 220, proxy.size.height - reservedControlsHeight)

        return CGRect(
            x: 24,
            y: top,
            width: max(0, proxy.size.width - 48),
            height: max(220, bottom - top)
        )
    }

    private func guideSize(for mode: CaptureMode, in targetZone: CGRect, screenWidth: CGFloat) -> CGSize {
        switch mode {
        case .ocr:
            let width = min(targetZone.width, 360)
            let height = min(targetZone.height * 0.9, width * 1.28)
            return CGSize(width: width, height: max(260, height))
        case .barcode:
            let width = min(targetZone.width, 360)
            let height = min(max(targetZone.height * 0.34, 128), 176)
            return CGSize(width: width, height: height)
        case .photo:
            let side = min(targetZone.width, targetZone.height * 0.84, 360)
            return CGSize(width: side, height: side)
        case .dictation:
            return .zero
        }
    }
}

struct SquareGrid: View {
    var body: some View {
        GeometryReader { proxy in
            Path { path in
                let thirdWidth = proxy.size.width / 3
                let thirdHeight = proxy.size.height / 3
                for index in 1...2 {
                    let x = thirdWidth * CGFloat(index)
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: proxy.size.height))

                    let y = thirdHeight * CGFloat(index)
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: proxy.size.width, y: y))
                }
            }
            .stroke(.white.opacity(0.36), lineWidth: 0.8)
        }
    }
}
