import SwiftUI

struct ScannerView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isCaptureSessionPresented = false
    @State private var isSessionsPresented = false
    let showsCameraLayer: Bool

    init(showsCameraLayer: Bool = true) {
        self.showsCameraLayer = showsCameraLayer
    }

    private var captureResults: [ScanResult] {
        store.results.filter { $0.source == .capture }
    }

    private var capturePhotoBatches: [CapturePhotoBatch] {
        let photoResults = captureResults.filter { $0.kind == .photo }
        let grouped = Dictionary(grouping: photoResults) { result in
            result.batchId ?? result.id.uuidString
        }
        return grouped.map { id, results in
            CapturePhotoBatch(
                id: id,
                results: results.sorted { $0.capturedAt < $1.capturedAt }
            )
        }
        .sorted { $0.latestCapturedAt > $1.latestCapturedAt }
    }

    private var captureHistoryItems: [CaptureHistoryItem] {
        let photoItems = capturePhotoBatches.map(CaptureHistoryItem.photoBatch)
        let resultItems = captureResults
            .filter { $0.kind != .photo }
            .map(CaptureHistoryItem.result)
        return (photoItems + resultItems)
            .sorted { $0.latestCapturedAt > $1.latestCapturedAt }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ScannerSectionHeader(
                        title: "Capture",
                        onConnectionControlTapped: {
                            isSessionsPresented = true
                        }
                    )

                    previousCaptures
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Capture")
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(
                isPresented: $isCaptureSessionPresented,
                onDismiss: {
                    store.endResumedPhotoBatch()
                }
            ) {
                CaptureSessionView(isPresented: $isCaptureSessionPresented)
            }
            .sheet(isPresented: $isSessionsPresented) {
                PairingSessionsView()
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .onAppear {
                store.selectedSection = .scan
                store.activeMode = ScreenshotScenario.current?.initialCaptureMode ?? .ocr
                if ScreenshotScenario.current?.opensCaptureSession == true {
                    isCaptureSessionPresented = true
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ScannerBottomActionAccessory(
                    title: "Start Capture",
                    systemImage: "doc.viewfinder",
                    isEnabled: store.connectionStatus.isConnected,
                    statusText: captureStatusText,
                    disabledHint: store.targetHint,
                    action: startCapture
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
        store.endResumedPhotoBatch()
        store.clearOcrReview()
        store.activeMode = ScreenshotScenario.current?.initialCaptureMode ?? .ocr
        isCaptureSessionPresented = true
    }

    private func addPhotos(to batch: CapturePhotoBatch) {
        guard store.connectionStatus.isConnected else { return }
        store.clearOcrReview()
        store.activeMode = .photo
        store.resumePhotoBatch(id: batch.id)
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
                    ForEach(captureHistoryItems) { item in
                        switch item {
                        case .photoBatch(let batch):
                            CapturePhotoBatchCard(
                                batch: batch,
                                canAddPhotos: store.connectionStatus.isConnected,
                                onAddPhotos: {
                                    addPhotos(to: batch)
                                },
                                onResend: { result in
                                    Task { await store.resendResultToChrome(id: result.id) }
                                },
                                onDelete: { result in
                                    store.removeResult(id: result.id)
                                }
                            )
                        case .result(let result):
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

}

private enum CaptureHistoryItem: Identifiable {
    case photoBatch(CapturePhotoBatch)
    case result(ScanResult)

    var id: String {
        switch self {
        case .photoBatch(let batch):
            "batch-\(batch.id)"
        case .result(let result):
            "result-\(result.id.uuidString)"
        }
    }

    var latestCapturedAt: Date {
        switch self {
        case .photoBatch(let batch):
            batch.latestCapturedAt
        case .result(let result):
            result.capturedAt
        }
    }
}

private struct CapturePhotoBatch: Identifiable {
    let id: String
    let results: [ScanResult]

    var latestCapturedAt: Date {
        results.map(\.capturedAt).max() ?? .distantPast
    }

    var title: String {
        "\(results.count) captured photo\(results.count == 1 ? "" : "s")"
    }
}

private struct CapturePhotoBatchCard: View {
    let batch: CapturePhotoBatch
    let canAddPhotos: Bool
    let onAddPhotos: () -> Void
    let onResend: (ScanResult) -> Void
    let onDelete: (ScanResult) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(batch.title)
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    Text(batch.latestCapturedAt, format: .dateTime.hour().minute())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                Button(action: onAddPhotos) {
                    Label("Add Photos", systemImage: "plus.viewfinder")
                }
                .buttonStyle(.bordered)
                .disabled(!canAddPhotos)
                .accessibilityLabel("Add photos to \(batch.title) from \(batch.latestCapturedAt.formatted(date: .abbreviated, time: .shortened))")
            }

            ForEach(batch.results) { result in
                CapturedResultRow(
                    result: result,
                    canResend: canAddPhotos,
                    onResend: {
                        onResend(result)
                    },
                    onDelete: {
                        onDelete(result)
                    }
                )
                .padding(.top, 2)
            }
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
