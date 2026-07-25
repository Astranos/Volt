import SwiftUI

/// One frame in the bottom-left capture strip shown while a photo session is running.
struct SessionPhotoThumbnail: Identifiable, Equatable {
    let id: UUID
    let image: UIImage

    init(id: UUID = UUID(), image: UIImage) {
        self.id = id
        self.image = image
    }
}

struct CameraSessionControls: View {
    private let sideToolSlotWidth: CGFloat = 64
    private let toolRowMaxWidth: CGFloat = 380

    @Binding var activeMode: CaptureMode
    let torchEnabled: Bool
    let zoomLabel: String
    let gridVisible: Bool
    let hasLiveTextCandidates: Bool
    let isRecognizingText: Bool
    var isCaptureEnabled = true
    var showsModePicker = true
    var barcodeHint = "Point camera at barcode"
    var hasLatestCapture = false
    var capturedThumbnails: [SessionPhotoThumbnail] = []
    var capturedCount = 0
    var controlRotation: Angle = .zero
    let onToggleTorch: () -> Void
    let onZoomOut: () -> Void
    let onZoomIn: () -> Void
    let onToggleGrid: () -> Void
    let onCapture: () -> Void
    var onSendLatest: (() -> Void)?
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            cameraToolsRow
                .opacity(isCaptureEnabled ? 1 : 0.45)

            Text(captureHint)
                .font(.subheadline.bold())
                .foregroundStyle(isCaptureEnabled ? .white : .white.opacity(0.55))
                .frame(maxWidth: .infinity)

            ZStack {
                HStack {
                    leadingSlot

                    Spacer()

                    trailingSlot
                }

                shutterButton
            }
            .frame(height: 96)

            if showsModePicker {
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
                .disabled(!isCaptureEnabled)
                .opacity(isCaptureEnabled ? 1 : 0.55)
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

    private var leadingSlot: some View {
        ZStack {
            Color.clear
            if !capturedThumbnails.isEmpty {
                CapturedPhotoStrip(
                    thumbnails: capturedThumbnails,
                    count: capturedCount,
                    badgeRotation: controlRotation
                )
            }
        }
        .frame(width: 88, height: 96)
        .animation(.spring(response: 0.3, dampingFraction: 0.78), value: capturedThumbnails.first?.id)
    }

    private var trailingSlot: some View {
        ZStack {
            Color.clear
            if hasLatestCapture, let onSendLatest {
                SessionIconButton(
                    systemImage: "paperplane.fill",
                    label: "Send latest capture",
                    rotation: controlRotation,
                    action: onSendLatest
                )
            }
        }
        .frame(width: 88, height: 48)
    }

    private var captureHint: String {
        switch activeMode {
        case .ocr:
            hasLiveTextCandidates ? "Tap a recognized chip to send" : "Frame device identifiers"
        case .barcode:
            barcodeHint
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
                    .rotationEffect(controlRotation)
                    .animation(.easeInOut(duration: 0.24), value: controlRotation)
            }
        }
        .disabled(isRecognizingText || !isCaptureEnabled)
        .opacity(isCaptureEnabled ? 1 : 0.55)
        .accessibilityLabel(shutterAccessibilityLabel)
    }
}

/// Newest-first stack of shots taken in this session, mirroring the Camera app's bottom-left corner.
struct CapturedPhotoStrip: View {
    private let side: CGFloat = 58
    private let cornerRadius: CGFloat = 13

    let thumbnails: [SessionPhotoThumbnail]
    let count: Int
    var badgeRotation: Angle = .zero

    var body: some View {
        ZStack {
            ForEach(Array(thumbnails.enumerated()).reversed(), id: \.element.id) { index, thumbnail in
                thumbnailCard(thumbnail, depth: index)
            }
        }
        .shadow(color: .black.opacity(0.4), radius: 6, y: 3)
        .overlay(alignment: .bottomTrailing) {
            countBadge
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count) photo\(count == 1 ? "" : "s") captured this session")
    }

    private func thumbnailCard(_ thumbnail: SessionPhotoThumbnail, depth: Int) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let isTop = depth == 0

        return Image(uiImage: thumbnail.image)
            .resizable()
            .scaledToFill()
            .frame(width: side, height: side)
            .clipShape(shape)
            .overlay {
                shape.stroke(.white.opacity(isTop ? 0.85 : 0.4), lineWidth: 1.5)
            }
            .offset(x: CGFloat(depth) * -3, y: CGFloat(depth) * -4)
            .opacity(isTop ? 1 : 0.68)
            .zIndex(Double(thumbnails.count - depth))
            .transition(.scale(scale: 0.55).combined(with: .opacity))
    }

    @ViewBuilder
    private var countBadge: some View {
        if count > 1 {
            Text("\(count)")
                .font(.caption2.monospacedDigit().bold())
                .foregroundStyle(.black)
                .rotationEffect(badgeRotation)
                .animation(.easeInOut(duration: 0.24), value: badgeRotation)
                .frame(minWidth: 22, minHeight: 22)
                .background(.white, in: Capsule())
                .offset(x: 8, y: 6)
        }
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
