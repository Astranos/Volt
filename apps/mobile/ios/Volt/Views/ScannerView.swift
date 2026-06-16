import SwiftUI

struct ScannerView: View {
    @Environment(ScannerStore.self) private var store
    let showsCameraLayer: Bool
    private let scannerModes: [CaptureMode] = [.ocr, .barcode, .photo]

    init(showsCameraLayer: Bool = true) {
        self.showsCameraLayer = showsCameraLayer
    }

    var body: some View {
        @Bindable var store = store

        NavigationStack {
            ZStack(alignment: .bottom) {
                if showsCameraLayer {
                    if store.activeMode == .ocr, let reviewImage = store.ocrReviewImage {
                        OcrReviewLayer(image: reviewImage, text: $store.ocrReviewText)
                            .ignoresSafeArea()
                    } else {
                        ScannerCameraLayer()
                            .ignoresSafeArea()
                    }
                } else {
                    Color.clear
                }

                VStack(spacing: 14) {
                    statusPanel
                    actionControls
                }
                .padding()
                .background(.thinMaterial)
            }
            .navigationTitle("Scan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Mode", selection: $store.activeMode) {
                        ForEach(scannerModes) { mode in
                            Label(mode.title, systemImage: mode.symbolName)
                                .tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 260)
                }
            }
            .onChange(of: store.activeMode) { _, newMode in
                if newMode != .ocr {
                    store.clearOcrReview()
                }
            }
            .onChange(of: store.camera.lastBarcode) {
                store.saveBarcodeIfNeeded()
            }
        }
    }

    private var statusPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(store.statusText)
                .font(.headline)
            Text(store.targetHint)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if store.activeMode == .ocr, store.ocrReviewImage != nil {
                Text(store.ocrReviewText.isEmpty ? "Review text before sending." : "Edit, copy, or send captured text.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let barcode = store.camera.lastBarcode {
                Text(barcode)
                    .font(.footnote.monospaced())
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actionControls: some View {
        Group {
            if store.activeMode == .ocr, store.ocrReviewImage != nil {
                HStack(spacing: 10) {
                    Button("Retake", systemImage: "arrow.clockwise", action: store.clearOcrReview)
                        .buttonStyle(.bordered)

                    Button("Copy", systemImage: "doc.on.doc", action: store.copyOcrReviewText)
                        .buttonStyle(.bordered)
                        .disabled(store.ocrReviewText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button("Send", systemImage: "paperplane.fill", action: store.sendOcrReviewText)
                        .buttonStyle(.borderedProminent)
                        .disabled(store.ocrReviewText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            } else {
                Button {
                    Task { await store.capture() }
                } label: {
                    Label(captureButtonTitle, systemImage: captureButtonSymbol)
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(store.isRecognizingText)
            }
        }
    }

    private var captureButtonTitle: String {
        if store.isRecognizingText {
            return "Reading Text"
        }
        switch store.activeMode {
        case .ocr:
            return "Capture Text"
        case .barcode:
            return "Send Barcode"
        case .photo:
            return "Take Square Photo"
        case .dictation:
            return "Capture"
        }
    }

    private var captureButtonSymbol: String {
        switch store.activeMode {
        case .ocr:
            return store.isRecognizingText ? "hourglass" : "text.viewfinder"
        case .barcode:
            return "barcode.viewfinder"
        case .photo:
            return "camera.circle.fill"
        case .dictation:
            return "camera.circle.fill"
        }
    }
}

struct ScannerCameraLayer: View {
    @Environment(ScannerStore.self) private var store

    var body: some View {
        Group {
            if store.camera.authorizationStatus == .authorized {
                CameraPreview(previewLayer: store.camera.previewLayer)
                    .overlay(alignment: .center) {
                        CaptureGuideOverlay(mode: store.activeMode)
                    }
            } else {
                ContentUnavailableView(
                    "Camera Access Required",
                    systemImage: "camera",
                    description: Text("Enable camera access to scan barcodes, capture photos, and run text recognition.")
                )
            }
        }
    }
}

struct OcrReviewLayer: View {
    let image: UIImage
    @Binding var text: String

    var body: some View {
        ZStack {
            Color.black

            VStack(spacing: 0) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.top, 52)
                    .padding(.horizontal, 12)

                TextEditor(text: $text)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .foregroundStyle(.primary)
                    .padding(10)
                    .frame(height: 190)
                    .background(.regularMaterial)
            }
        }
    }
}

struct CaptureGuideOverlay: View {
    let mode: CaptureMode

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width - 48, proxy.size.height * 0.58)

            ZStack {
                switch mode {
                case .barcode:
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(.green, lineWidth: 3)
                        .frame(width: min(proxy.size.width - 64, 340), height: 190)
                        .overlay {
                            Rectangle()
                                .fill(.green.opacity(0.75))
                                .frame(height: 2)
                                .padding(.horizontal, 16)
                        }
                case .photo:
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(.white.opacity(0.72), lineWidth: 1.2)
                        .background(.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 24))
                        .frame(width: side, height: side)
                        .overlay {
                            SquareGrid()
                                .clipShape(RoundedRectangle(cornerRadius: 24))
                                .frame(width: side, height: side)
                        }
                case .ocr:
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(.white.opacity(0.62), lineWidth: 2)
                        .frame(width: min(proxy.size.width - 48, 360), height: min(proxy.size.height * 0.56, 420))
                case .dictation:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .allowsHitTesting(false)
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
