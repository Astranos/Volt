import SwiftUI

struct ScannerView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isCaptureSessionPresented = false
    let showsCameraLayer: Bool

    init(showsCameraLayer: Bool = true) {
        self.showsCameraLayer = showsCameraLayer
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    captureHeader
                    startCaptureButton
                    previousCaptures
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Capture")
            .fullScreenCover(isPresented: $isCaptureSessionPresented) {
                CaptureSessionView(isPresented: $isCaptureSessionPresented)
            }
            .onAppear {
                store.activeMode = .ocr
            }
        }
    }

    private var captureHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle()
                    .fill(store.connectionStatus.isConnected ? .green : .orange)
                    .frame(width: 9, height: 9)
                Text(store.connectionStatus.isConnected ? "Paired to Chrome" : "Not paired")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            Text("Documents")
                .font(.largeTitle.weight(.bold))

            Text(store.connectionStatus.isConnected ? store.targetHint : "Start a full-screen capture session. Pair when you want text sent directly to Chrome.")
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var startCaptureButton: some View {
        Button {
            store.clearOcrReview()
            store.activeMode = .ocr
            isCaptureSessionPresented = true
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "doc.viewfinder")
                    .font(.system(size: 28, weight: .semibold))
                    .frame(width: 54, height: 54)
                    .background(.white.opacity(0.18), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text("Start Capture")
                        .font(.title3.weight(.bold))
                    Text("Open the camera without tabs or extra controls.")
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
            .background(.blue, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var previousCaptures: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Previously Captured")
                    .font(.headline)
                Spacer()
                Text("\(store.results.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if store.results.isEmpty {
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
                    ForEach(store.results) { result in
                        CapturedResultRow(result: result)
                            .padding(14)
                            .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                }
            }
        }
    }

}

struct CaptureSessionView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var isPresented: Bool
    @State private var gridVisible = true

    var body: some View {
        @Bindable var store = store

        ZStack {
            if let reviewImage = store.ocrReviewImage {
                OcrReviewLayer(image: reviewImage)
                    .ignoresSafeArea()
            } else {
                ScannerCameraLayer(gridVisible: gridVisible)
                    .ignoresSafeArea()
            }
        }
        .background(.black)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if store.ocrReviewImage != nil {
                ReviewCaptureDock(
                    statusText: store.connectionStatus.isConnected ? "Ready to send" : "Review capture",
                    text: $store.ocrReviewText,
                    onRetake: store.clearOcrReview,
                    onCopy: store.copyOcrReviewText,
                    onSend: {
                        store.sendOcrReviewText()
                        store.clearOcrReview()
                        isPresented = false
                    }
                )
            } else {
                CameraSessionControls(
                    activeMode: $store.activeMode,
                    torchEnabled: store.camera.torchEnabled,
                    zoomLabel: String(format: "%.1fx", Double(store.camera.zoomFactor)),
                    gridVisible: gridVisible,
                    isRecognizingText: store.isRecognizingText,
                    onFinish: {
                        store.clearOcrReview()
                        isPresented = false
                    },
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
        .onAppear {
            store.activeMode = .ocr
            store.camera.start()
        }
        .onDisappear {
            store.camera.stop()
        }
    }
}

struct CameraSessionControls: View {
    @Binding var activeMode: CaptureMode
    let torchEnabled: Bool
    let zoomLabel: String
    let gridVisible: Bool
    let isRecognizingText: Bool
    let onFinish: () -> Void
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
                    Button(action: onFinish) {
                        Text("Finish")
                            .font(.subheadline.bold())
                            .foregroundStyle(.white)
                            .frame(minWidth: 88, minHeight: 48)
                            .background(.black.opacity(0.54), in: Capsule())
                    }

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
            .tint(.blue)
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
        Group {
            if activeMode == .photo {
                Text(gridVisible ? "Grid on" : "Grid off")
                    .font(.subheadline.bold())
                    .foregroundStyle(.white.opacity(0.86))
                    .frame(minWidth: 88, minHeight: 48)
                    .background(.black.opacity(0.38), in: Capsule())
            } else {
                Color.clear
                    .frame(width: 88, height: 48)
            }
        }
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
    var gridVisible = false

    var body: some View {
        Group {
            if store.camera.authorizationStatus == .authorized {
                CameraPreview(previewLayer: store.camera.previewLayer) { point in
                    store.camera.focus(at: point)
                }
                    .overlay(alignment: .center) {
                        CaptureGuideOverlay(mode: store.activeMode, gridVisible: gridVisible)
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
}

struct CapturedResultRow: View {
    let result: ScanResult

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.headline)
                .foregroundStyle(.tint)
                .frame(width: 26)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(result.value)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .textSelection(.enabled)
                Text(result.format)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var title: String {
        switch result.kind {
        case .barcode: "Barcode"
        case .text: "Document Text"
        case .photo: "Photo"
        case .dictation: "Dictation"
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
    let onCopy: () -> Void
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

                Button("Copy", systemImage: "doc.on.doc", action: onCopy)
                    .buttonStyle(.bordered)
                    .tint(.white)
                    .disabled(!hasText)

                Button("Send", systemImage: "paperplane.fill", action: onSend)
                    .buttonStyle(.borderedProminent)
                    .tint(.blue)
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

struct OcrReviewLayer: View {
    let image: UIImage

    var body: some View {
        ZStack {
            Color.black

            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.top, 48)
                .padding(.horizontal, 12)
                .padding(.bottom, 250)
        }
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
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(.white.opacity(0.62), lineWidth: 2)
                        .frame(width: guideSize.width, height: guideSize.height)
                        .position(x: targetZone.midX, y: targetZone.midY)
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
