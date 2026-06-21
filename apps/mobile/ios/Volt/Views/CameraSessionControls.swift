import SwiftUI

struct CameraSessionControls: View {
    private let sideToolSlotWidth: CGFloat = 64
    private let toolRowMaxWidth: CGFloat = 380

    @Binding var activeMode: CaptureMode
    let torchEnabled: Bool
    let zoomLabel: String
    let gridVisible: Bool
    let hasLiveTextCandidates: Bool
    let isRecognizingText: Bool
    let onToggleTorch: () -> Void
    let onZoomOut: () -> Void
    let onZoomIn: () -> Void
    let onToggleGrid: () -> Void
    let onCapture: () -> Void
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 10) {
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

            Button("End session", systemImage: "xmark", action: onFinish)
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(minHeight: 40)
                .background(.black.opacity(0.58), in: Capsule())
                .overlay {
                    Capsule().stroke(.white.opacity(0.14), lineWidth: 1)
                }
                .padding(.top, 14)
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

    private var cameraToolsRow: some View {
        HStack {
            gridToolSlot

            Spacer()

            zoomControls

            Spacer()

            flashToolSlot
        }
        .frame(maxWidth: toolRowMaxWidth)
    }

    private var zoomControls: some View {
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
    }

    private var gridToolSlot: some View {
        toolSlot {
            if activeMode == .photo {
                SessionIconButton(
                    systemImage: gridVisible ? "grid" : "square",
                    isActive: gridVisible,
                    label: gridVisible ? "Hide grid lines" : "Show grid lines",
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
                label: torchEnabled ? "Turn flash off" : "Turn flash on",
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

    private var trailingSlot: some View {
        Color.clear
            .frame(width: 88, height: 48)
    }

    private var captureHint: String {
        switch activeMode {
        case .ocr:
            hasLiveTextCandidates ? "Tap a recognized chip to send" : "Frame device identifiers"
        case .barcode:
            ScreenshotScenario.current == .captureBarcode ? "Send '883929739929'" : "Point camera at barcode"
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

struct LiveIdentifierStrip: View {
    let candidates: [LiveTextCandidate]
    let onSend: (LiveTextCandidate) -> Void

    var body: some View {
        let visibleCandidates = deduplicatedCandidates
        if !visibleCandidates.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(visibleCandidates) { candidate in
                        LiveIdentifierChip(candidate: candidate) {
                            onSend(candidate)
                        }
                    }
                }
                .padding(.horizontal, 18)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
            .transition(.opacity)
        }
    }

    private var deduplicatedCandidates: [LiveTextCandidate] {
        var seen = Set<String>()
        return candidates.filter { candidate in
            let key = "\(candidate.kind.rawValue):\(candidate.value.uppercased())"
            guard !seen.contains(key) else { return false }
            seen.insert(key)
            return true
        }
        .prefix(4)
        .map { $0 }
    }
}

struct LiveIdentifierChip: View {
    let candidate: LiveTextCandidate
    let onSend: () -> Void

    var body: some View {
        Button(action: onSend) {
            HStack(spacing: 6) {
                Text(candidate.kind.rawValue)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.black.opacity(0.72))
                Text(candidate.value)
                    .font(.caption.monospaced().weight(.semibold))
                    .foregroundStyle(.black)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(.cyan.opacity(0.92), in: Capsule())
            .overlay {
                Capsule().stroke(.white.opacity(0.28), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(candidate.kind.rawValue) \(candidate.value)")
        .accessibilityHint("Sends this detected identifier")
    }
}
