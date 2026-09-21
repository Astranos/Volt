@preconcurrency import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ClipCaptureView: View {
    @Bindable var store: ClipScannerStore
    let mode: CaptureMode
    @Binding var requestedSessionBatchId: String?
    let onScanQRCode: () -> Void
    @State private var isCaptureSessionPresented = false
    @State private var captureSessionBatchId: String?
    @State private var opensPairingScannerAfterCapture = false
    @State private var isTargetPickerPresented = false
    @State private var isSettingsPresented = false
    @State private var opensConnectionAfterTargetPicker = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ClipChromeSectionHeader(
                        title: "Volt",
                        connection: connectionSummary,
                        onConnectionTapped: showConnections
                    )

                    ClipCaptureLaunchCard(action: startCapture)

                    ClipWorkspaceTargetCard(store: store, action: showConnections)

                    ClipPhotoLibraryUploadSection(store: store)

                    ClipUnifiedHistoryView(store: store) { batchId in
                        requestedSessionBatchId = batchId
                    }

                    Text("One camera for text, barcodes, photos, and audio. Switch modes without leaving the session.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)


                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, 32)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Volt")
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(
                isPresented: $isCaptureSessionPresented,
                onDismiss: {
                    store.endCaptureSession(id: captureSessionBatchId)
                    captureSessionBatchId = nil
                    if opensPairingScannerAfterCapture {
                        opensPairingScannerAfterCapture = false
                        onScanQRCode()
                    }
                }
            ) {
                ClipCaptureSessionView(
                    store: store,
                    activeMode: $store.activeCaptureMode,
                    isConnected: store.isConnected,
                    isRecognizingText: store.isRecognizingText || store.isDictationBusy,
                    ocrReviewImage: store.ocrReviewImage,
                    ocrTextRegions: store.ocrTextRegions,
                    statusText: captureStatusText,
                    captureBatchId: captureSessionBatchId,
                    onBarcodeScan: { scan in
                        store.handleBarcodeScan(scan)
                    },
                    onCaptureImage: { image, mode, batchId in
                        switch mode {
                        case .ocr:
                            Task { await store.recognizeText(in: image) }
                        case .barcode:
                            break
                        case .photo, .dictation:
                            Task { await store.capturePhoto(image, batchId: batchId) }
                        }
                    },
                    onSendRecognizedText: { text in
                        store.sendRecognizedText(text)
                    },
                    onClearOcrReview: {
                        store.clearOcrReview()
                    },
                    onConnectionScannerRequested: {
                        opensPairingScannerAfterCapture = true
                    }
                )
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear
                    .frame(height: ScannerHomeControls.reservedSpace)
                    .accessibilityHidden(true)
            }
            .overlay(alignment: .bottom) {
                GeometryReader { proxy in
                    ScannerHomeControls(
                        onScan: startCapture,
                        onConnections: showConnections,
                        onSettings: { isSettingsPresented = true },
                        targetSymbol: targetSymbol
                    )
                    .padding(.horizontal, 16)
                    .padding(.bottom, 20)
                    .offset(y: proxy.safeAreaInsets.bottom)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                }
            }
            .sheet(isPresented: $isTargetPickerPresented, onDismiss: {
                if opensConnectionAfterTargetPicker {
                    opensConnectionAfterTargetPicker = false
                    onScanQRCode()
                }
            }) {
                ClipWorkspaceTargetPickerSheet(store: store) {
                    opensConnectionAfterTargetPicker = true
                }
            }
            .sheet(isPresented: $isSettingsPresented) {
                ClipSettingsSheet()
            }
            .onAppear {
                store.activeCaptureMode = mode
            }
            .onChange(of: requestedSessionBatchId) { _, batchId in
                guard let batchId else { return }
                store.clearOcrReview()
                store.activeCaptureMode = .ocr
                captureSessionBatchId = store.resumeCaptureSession(batchId: batchId)
                isCaptureSessionPresented = true
                requestedSessionBatchId = nil
            }
        }
    }

    private func showConnections() {
        if store.canChooseWorkspaceComputer {
            isTargetPickerPresented = true
        } else {
            onScanQRCode()
        }
    }

    private func startCapture() {
        store.clearOcrReview()
        store.activeCaptureMode = .ocr
        captureSessionBatchId = store.beginCaptureSession()
        isCaptureSessionPresented = true
    }

    private var connectionSummary: ScannerConnectionSummary {
        ScannerConnectionSummary(
            isConnected: store.isConnected,
            isBusy: store.isPairing,
            title: store.isConnected ? store.typingTargetLabel : clipConnectionTitle(
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
            "Ready to \(mode.clipActionVerb) into \(store.typingTargetLabel)"
        } else {
            store.targetHint
        }
    }

    private var targetSymbol: String {
        if store.selectedWorkspaceComputerId == nil { return "iphone" }
        if store.selectedWorkspaceComputer == nil { return "desktopcomputer.trianglebadge.exclamationmark" }
        return "cursorarrow.motionlines"
    }
}

struct ClipCaptureLaunchCard: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "camera.viewfinder")
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 68, height: 68)
                    .background(.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 20, style: .continuous))

                VStack(alignment: .leading, spacing: 6) {
                    Text("Start a scan session").font(.title2.bold())
                    Text("Capture text, barcodes, photos, and audio without leaving the camera.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.82))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(.white)

                Label("Open Camera", systemImage: "arrow.right.circle.fill")
                    .font(.headline)
                    .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(22)
            .background(
                LinearGradient(colors: [.green, .green.opacity(0.68)], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: 24, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the unified camera with Text selected.")
    }
}

struct ClipSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            List {
                Section("App Clip") {
                    Label("Guest workspace session", systemImage: "person.crop.circle")
                    Text("Scan a Volt workspace QR to capture without signing in. Keep this App Clip open while uploads finish.")
                        .foregroundStyle(.secondary)
                }
                Section("Permissions") {
                    Button("Open iOS Settings", systemImage: "gearshape") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            openURL(url)
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

struct ClipChromeSectionHeader: View {
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
            .accessibilityLabel(connection.isConnected ? connection.statusText : "Connect to workspace")
            .accessibilityHint(connection.isBusy ? "Shows connection progress." : "Shows connection options.")
        }
    }

    private var connectionIcon: String {
        if connection.isConnected {
            return "character.cursor.ibeam"
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
