import SwiftUI

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
