import SwiftUI

struct CameraSessionTopStatus: View {
    let activeMode: CaptureMode
    var liveTextCandidates: [LiveTextCandidate] = []
    var barcodeHint = "Point camera at barcode"
    var isProductScannerSelected = false
    var productScanMode: ProductScanMode = .upc
    var isProductScanBusy = false
    var productScanQuotaText: String?
    var productScanOutput: ProductScanOutput?
    var productScanError: String?
    let onSendLiveText: (LiveTextCandidate) -> Void

    var body: some View {
        Group {
            if isProductScannerSelected {
                productStatus
            } else if activeMode == .ocr, !liveTextCandidates.isEmpty {
                LiveIdentifierStrip(
                    candidates: liveTextCandidates,
                    onSend: onSendLiveText
                )
            } else {
                Label(captureHint, systemImage: activeMode.symbolName)
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 58)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.black.opacity(0.48), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.white.opacity(0.14), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.28), radius: 9, y: 4)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var productStatus: some View {
        if let productScanError {
            Label(productScanError, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.orange)
                .lineLimit(2)
                .multilineTextAlignment(.center)
        } else if let productScanOutput {
            VStack(spacing: 3) {
                Label(
                    productScanOutput.mode == .upc ? "UPC found" : "Product found",
                    systemImage: productScanOutput.mode.systemImage
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.76))

                Text(productScanOutput.value)
                    .font(productScanOutput.mode == .upc ? .headline.monospaced() : .headline)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.82)
            }
        } else {
            VStack(spacing: 4) {
                ProductScanProgressText(mode: productScanMode, isBusy: isProductScanBusy)
                if let productScanQuotaText {
                    Text(productScanQuotaText)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.white.opacity(0.72))
                        .lineLimit(1)
                }
            }
        }
    }

    private var captureHint: String {
        switch activeMode {
        case .ocr:
            "Frame device identifiers"
        case .barcode:
            barcodeHint
        case .photo:
            "Frame photo"
        case .dictation:
            "Tap to start or stop audio"
        }
    }
}

struct CameraSessionControls: View {
    private let sideToolSlotWidth: CGFloat = 64
    private let toolRowMaxWidth: CGFloat = 380
    private let modeButtonWidth: CGFloat = 64

    @Binding var activeMode: CaptureMode
    let torchEnabled: Bool
    let zoomLabel: String
    let gridVisible: Bool
    let isRecognizingText: Bool
    var isCaptureEnabled = true
    var isModeSelectionEnabled = true
    var showsModePicker = true
    var controlRotation: Angle = .zero
    var showsProductScanner = false
    var isProductScannerSelected = false
    var productScannerAvailable = true
    var productScanMode: ProductScanMode = .upc
    var connectionSystemImage = "character.cursor.ibeam"
    var connectionLabel = "Write"
    var connectionAccessibilityLabel = "Choose write destination"
    let onToggleTorch: () -> Void
    let onZoomOut: () -> Void
    let onZoomIn: () -> Void
    let onToggleGrid: () -> Void
    let onCapture: () -> Void
    var onConnection: (() -> Void)?
    var onSelectProductScanner: (() -> Void)?
    var onToggleProductScanMode: (() -> Void)?
    var onDeactivateProductScanner: (() -> Void)?
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            cameraToolsRow
                .opacity(isCaptureEnabled ? 1 : 0.45)

            if showsModePicker {
                modePicker
            }

            ZStack {
                HStack {
                    connectionSlot

                    Spacer()

                    finishSlot
                }

                shutterButton
            }
            .frame(height: 96)
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
        .padding(.bottom, 12)
        .background {
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.78), .black.opacity(0.94)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        }
    }

    private var selectedModeID: String {
        isProductScannerSelected ? "ai" : activeMode.rawValue
    }

    private var modePicker: some View {
        GeometryReader { geometry in
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 18) {
                        modeButton("Text", mode: .ocr)
                        modeButton("Barcode", mode: .barcode)
                        modeButton("Photo", mode: .photo)
                        modeButton("Audio", mode: .dictation)
                        if showsProductScanner, let onSelectProductScanner {
                            productModeButton(action: onSelectProductScanner)
                        }
                    }
                    .padding(.horizontal, max(0, (geometry.size.width - modeButtonWidth) / 2))
                }
                .onAppear {
                    proxy.scrollTo(selectedModeID, anchor: .center)
                }
                .onChange(of: selectedModeID) { _, modeID in
                    withAnimation(.easeInOut(duration: 0.24)) {
                        proxy.scrollTo(modeID, anchor: .center)
                    }
                }
            }
        }
        .frame(height: 42)
        .disabled(!isModeSelectionEnabled)
        .opacity(isModeSelectionEnabled ? 1 : 0.55)
    }

    private var cameraToolsRow: some View {
        HStack {
            if isProductScannerSelected, let onToggleProductScanMode {
                productScanToolSlot(action: onToggleProductScanMode)
            } else {
                gridToolSlot
            }

            Spacer()

            zoomControls

            Spacer()

            flashToolSlot
        }
        .frame(maxWidth: toolRowMaxWidth)
    }

    private var zoomControls: some View {
        HStack(spacing: 8) {
            SessionIconButton(
                systemImage: "minus.magnifyingglass",
                isEnabled: isCaptureEnabled,
                label: "Zoom out",
                rotation: controlRotation,
                action: onZoomOut
            )
            Text(zoomLabel)
                .font(.subheadline.monospacedDigit().bold())
                .foregroundStyle(.white)
                .rotationEffect(controlRotation)
                .animation(.easeInOut(duration: 0.24), value: controlRotation)
                .frame(minWidth: 58)
            SessionIconButton(
                systemImage: "plus.magnifyingglass",
                isEnabled: isCaptureEnabled,
                label: "Zoom in",
                rotation: controlRotation,
                action: onZoomIn
            )
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 56)
        .background(.black.opacity(0.54), in: Capsule())
        .overlay {
            Capsule().stroke(.white.opacity(0.14), lineWidth: 1)
        }
    }

    private var gridToolSlot: some View {
        toolSlot {
            if activeMode == .photo {
                SessionIconButton(
                    systemImage: gridVisible ? "grid" : "square",
                    isActive: gridVisible,
                    isEnabled: isCaptureEnabled,
                    label: gridVisible ? "Hide grid lines" : "Show grid lines",
                    rotation: controlRotation,
                    action: onToggleGrid
                )
            }
        }
    }

    private var flashToolSlot: some View {
        toolSlot {
            SessionIconButton(
                systemImage: torchEnabled ? "bolt.fill" : "bolt.slash",
                isActive: torchEnabled,
                isEnabled: isCaptureEnabled,
                label: torchEnabled ? "Turn flash off" : "Turn flash on",
                rotation: controlRotation,
                action: onToggleTorch
            )
        }
    }

    private func toolSlot<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ZStack {
            Color.clear
            content()
        }
        .frame(width: sideToolSlotWidth, height: sideToolSlotWidth)
    }

    private var connectionSlot: some View {
        ZStack {
            Color.clear
            if let onConnection {
                SessionSideActionButton(
                    systemImage: connectionSystemImage,
                    title: connectionLabel,
                    accessibilityLabel: connectionAccessibilityLabel,
                    rotation: controlRotation,
                    action: onConnection
                )
            }
        }
        .frame(width: 88, height: 82)
    }

    private var finishSlot: some View {
        SessionSideActionButton(
            systemImage: "xmark",
            title: "End",
            accessibilityLabel: "End session",
            rotation: controlRotation,
            action: onFinish
        )
        .frame(width: 88, height: 82)
    }

    private func modeButton(_ title: String, mode: CaptureMode) -> some View {
        Button {
            onDeactivateProductScanner?()
            activeMode = mode
        } label: {
            VStack(spacing: 5) {
                Text(title)
                    .font(.subheadline.weight(activeMode == mode ? .bold : .medium))
                Capsule()
                    .fill(activeMode == mode ? .white : .clear)
                    .frame(width: 22, height: 3)
            }
            .foregroundStyle(activeMode == mode ? .white : .white.opacity(0.68))
            .frame(width: modeButtonWidth, height: 36)
        }
        .buttonStyle(.plain)
        .id(mode.rawValue)
        .accessibilityAddTraits(activeMode == mode ? .isSelected : [])
        .accessibilityLabel("Capture mode \(title)")
    }

    private func productModeButton(action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Text("AI")
                    .font(.subheadline.weight(isProductScannerSelected ? .bold : .medium))
                Capsule()
                    .fill(isProductScannerSelected ? .white : .clear)
                    .frame(width: 22, height: 3)
            }
            .foregroundStyle(.white.opacity(productScannerAvailable ? 0.92 : 0.56))
            .frame(width: modeButtonWidth, height: 36)
        }
        .buttonStyle(.plain)
        .id("ai")
        .accessibilityAddTraits(isProductScannerSelected ? .isSelected : [])
        .accessibilityLabel("AI product scan")
        .accessibilityValue(productScannerAvailable ? "Available" : "AI scan limit reached for this period")
        .accessibilityHint("Returns the selected product UPC or name")
    }

    private func productScanToolSlot(action: @escaping () -> Void) -> some View {
        toolSlot {
            SessionIconButton(
                systemImage: productScanMode.systemImage,
                isEnabled: isCaptureEnabled && productScannerAvailable,
                label: productScanMode == .upc ? "Product scan UPC; switch to name" : "Product scan name; switch to UPC",
                rotation: controlRotation,
                action: action
            )
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
            return "mic.fill"
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
            return "Start or stop audio"
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
                    .rotationEffect(controlRotation)
                    .animation(.easeInOut(duration: 0.24), value: controlRotation)
            }
        }
        .disabled(isRecognizingText || !isCaptureEnabled)
        .opacity(isCaptureEnabled ? 1 : 0.55)
        .accessibilityLabel(shutterAccessibilityLabel)
    }
}

private struct ProductScanProgressText: View {
    let mode: ProductScanMode
    let isBusy: Bool
    @State private var step = 0

    private var messages: [String] {
        switch mode {
        case .upc:
            ["Identifying game", "Searching game catalog", "Verifying UPC"]
        case .name:
            ["Identifying product", "Reading the title", "Finishing result"]
        }
    }

    private var message: String {
        isBusy ? messages[step % messages.count] + "…" : "Frame the game case or disc"
    }

    var body: some View {
        ZStack {
            Text(message)
                .id(message)
                .transition(.asymmetric(
                    insertion: .move(edge: .bottom).combined(with: .opacity),
                    removal: .move(edge: .top).combined(with: .opacity)
                ))
        }
        .font(.subheadline.bold())
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, minHeight: 20)
        .clipped()
        .animation(.easeInOut(duration: 0.32), value: message)
        .task(id: isBusy) {
            step = 0
            guard isBusy else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2.2))
                guard !Task.isCancelled else { return }
                step = (step + 1) % messages.count
            }
        }
        .accessibilityLabel(message)
    }
}

struct SessionIconButton: View {
    let systemImage: String
    var isActive = false
    var isEnabled = true
    let label: String
    var rotation: Angle = .zero
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(isActive ? .yellow : .white)
                .rotationEffect(rotation)
                .animation(.easeInOut(duration: 0.24), value: rotation)
                .frame(width: 44, height: 44)
                .background(.black.opacity(0.52), in: Circle())
                .overlay {
                    Circle().stroke(.white.opacity(0.12), lineWidth: 1)
                }
        }
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.55)
        .accessibilityLabel(label)
    }
}

private struct SessionSideActionButton: View {
    let systemImage: String
    let title: String
    let accessibilityLabel: String
    var rotation: Angle = .zero
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 46, height: 46)
                    .background(.black.opacity(0.56), in: Circle())
                    .overlay {
                        Circle().stroke(.white.opacity(0.14), lineWidth: 1)
                    }

                Text(title)
                    .font(.caption2.weight(.semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(.white)
            .rotationEffect(rotation)
            .animation(.easeInOut(duration: 0.24), value: rotation)
            .frame(width: 72, height: 76)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }
}
