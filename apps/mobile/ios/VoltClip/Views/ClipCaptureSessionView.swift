@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ClipCaptureSessionView: View {
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
    @State private var isShowingRawText = false
    @State private var isCleaningSelectedText = false
    @State private var cleanupRequestID = UUID()
    @State private var focusPoint: CGPoint?
    @State private var focusRequestID = UUID()
    @State private var cameraStateRevision = 0
    @State private var isConnectionSheetPresented = false
    private let topToolbarTopPadding: CGFloat = 12
    private let photoPreviewToolbarGap: CGFloat = 0

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
                        requestFocus(at: devicePoint, showingAt: layerPoint)
                    },
                    onPinch: { scale, phase in
                        cameraService.handleZoomGesture(scale: scale, phase: phase)
                    }
                )
                .ignoresSafeArea()
                .opacity(activeMode == .dictation ? 0 : 1)
                .allowsHitTesting(activeMode != .dictation)
            }

            VStack {
                CameraSessionTopStatus(
                    activeMode: activeMode,
                    liveTextCandidates: liveTextCandidates,
                    barcodeHint: detectedBarcodeBounds == nil ? "Point camera at barcode" : "Barcode found",
                    onSendLiveText: { candidate in
                        onSendRecognizedText(candidate.value)
                    }
                )
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
                                requestFocus(at: devicePoint, showingAt: layerPoint)
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
                    rawText: selectedTextRegion.text,
                    isShowingRaw: isShowingRawText,
                    isCleaning: isCleaningSelectedText,
                    onToggleRepresentation: {
                        isShowingRawText.toggle()
                    },
                    onSend: {
                        onSendRecognizedText(selectedTextValue)
                        resetSelectedText()
                    },
                    onDismiss: {
                        resetSelectedText()
                    }
                )
                .transition(.scale(scale: 0.96).combined(with: .opacity))
            }

            if activeMode == .dictation, ocrReviewImage == nil {
                VStack(spacing: 12) {
                    Image(systemName: store.isDictating ? "waveform" : "mic.fill")
                        .font(.system(size: 34, weight: .semibold))
                        .symbolEffect(.variableColor.iterative, isActive: store.isDictating)
                    Text(store.dictationTranscript.isEmpty ? "Tap the microphone to dictate" : store.dictationTranscript)
                        .font(.body.weight(.medium))
                        .multilineTextAlignment(.center)
                        .lineLimit(5)
                    Text(store.dictationPhase == .preparing ? "Preparing microphone…" : store.isDictating ? "Listening" : "Your final text will be sent with this session")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .foregroundStyle(.white)
                .padding(18)
                .frame(maxWidth: 340)
                .background(.black.opacity(0.62), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .padding(.horizontal, 24)
                .allowsHitTesting(false)
            }
        }
        .background(.black)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if ocrReviewImage != nil {
                ClipOcrReviewControls(
                    regionCount: ocrTextRegions.count,
                    onRetake: {
                        resetSelectedText()
                        cameraService.setTorchEnabled(false)
                        onClearOcrReview()
                    },
                    onFinish: {
                        resetSelectedText()
                        onClearOcrReview()
                        dismiss()
                    }
                )
            } else {
                CameraSessionControls(
                    activeMode: $activeMode,
                    torchEnabled: cameraService.torchEnabled,
                    zoomLabel: cameraService.zoomDisplayLabel,
                    gridVisible: gridVisible,
                    isRecognizingText: isRecognizingText || isCapturingPhoto || store.isDictationBusy,
                    isCaptureEnabled: !isCapturingPhoto && !isRecognizingText && !store.isDictationBusy,
                    isModeSelectionEnabled: !store.isDictating && !store.isDictationBusy,
                    showsModePicker: true,
                    controlRotation: .degrees(cameraService.captureOrientation.controlRotationDegrees),
                    connectionSystemImage: isConnected ? "character.cursor.ibeam" : "desktopcomputer",
                    connectionLabel: isConnected ? "Write" : "Connect",
                    connectionAccessibilityLabel: "Open connection options",
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
                        if activeMode == .dictation {
                            Task { await store.toggleDictation() }
                        } else {
                            captureCurrentFrame()
                        }
                    },
                    onConnection: {
                        isConnectionSheetPresented = true
                    },
                    onFinish: {
                        dismiss()
                    }
                )
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
            Task { await store.speechDictation.cancel() }
            resetSelectedText()
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
            resetSelectedText()
        }
        .onChange(of: isRecognizingText) { _, _ in
            syncCameraForOcrPostCapture()
        }
        .onChange(of: store.dictationPhase) { _, _ in
            syncCameraForOcrPostCapture()
        }
        .onChange(of: store.isConnected) { _, isConnected in
            isConnectionSheetPresented = !isConnected
            if !isConnected {
                resetSelectedText()
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

    private func requestFocus(at devicePoint: CGPoint, showingAt layerPoint: CGPoint) {
        let requestID = UUID()
        focusRequestID = requestID
        Task { @MainActor in
            let focusApplied = await cameraService.focus(at: devicePoint)
            guard focusApplied, focusRequestID == requestID else { return }
            focusPoint = layerPoint
            try? await Task.sleep(for: .milliseconds(750))
            if focusRequestID == requestID {
                focusPoint = nil
            }
        }
    }

    private func syncCameraForOcrPostCapture() {
        if activeMode == .dictation {
            cameraService.stop()
            return
        }
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
        resetSelectedText()
        selectedTextRegion = region
        cleanupSelectedText(region)
    }

    private func cleanupSelectedText(_ region: RecognizedTextRegion) {
        let requestID = UUID()
        cleanupRequestID = requestID
        isCleaningSelectedText = true
        isShowingRawText = false
        captureError = nil
        captureNotice = "Cleaning text"
        let context = nearbyOcrContext(for: region)
        Task { @MainActor in
            let result = await OcrTextCleaner.clean(text: region.text, context: context)
            guard cleanupRequestID == requestID,
                  selectedTextRegion?.id == region.id
            else { return }
            selectedCleanedText = result.text
            isCleaningSelectedText = false
            captureNotice = result.usedFoundationModel ? "Text cleaned on device" : "Text cleaned"
        }
    }

    private func resetSelectedText() {
        cleanupRequestID = UUID()
        selectedCleanedText = nil
        selectedTextRegion = nil
        isShowingRawText = false
        isCleaningSelectedText = false
    }

    private func nearbyOcrContext(for region: RecognizedTextRegion) -> String {
        let nearbyRegions = ocrTextRegions
            .filter { $0.id != region.id }
            .sorted { lhs, rhs in
                distance(from: region, to: lhs) < distance(from: region, to: rhs)
            }
            .prefix(4)
        let identifierKind = LiveTextIdentifierMatcher.match(region.text)?.kind.rawValue ?? "Text"
        return (["Selected identifier type: \(identifierKind)"] + nearbyRegions.map(\.text))
            .joined(separator: "\n")
    }

    private func distance(from region: RecognizedTextRegion, to other: RecognizedTextRegion) -> CGFloat {
        let dx = region.boundingBox.midX - other.boundingBox.midX
        let dy = region.boundingBox.midY - other.boundingBox.midY
        return (dx * dx) + (dy * dy)
    }

    private var selectedTextValue: String {
        guard let selectedTextRegion else { return "" }
        guard !isShowingRawText, let selectedCleanedText else {
            return selectedTextRegion.text
        }
        return selectedCleanedText
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

    private var selectedTextPreview: String {
        selectedTextValue
    }
}
