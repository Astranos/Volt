import SwiftUI

struct CaptureModeTabView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isCaptureSessionPresented = false
    @State private var isTargetPickerPresented = false
    @State private var hasAppliedScreenshotLaunch = false

    let mode: CaptureMode

    private var matchingResults: [ScanResult] {
        store.results.filter { result in
            switch mode {
            case .ocr:
                result.kind == .text && result.source == .capture
            case .barcode:
                result.kind == .barcode && result.source == .capture
            case .photo:
                result.kind == .photo && result.source == .capture
            case .dictation:
                result.kind == .dictation
            }
        }
    }

    private var capturePhotoBatches: [CapturePhotoBatch] {
        let grouped = Dictionary(grouping: matchingResults) { result in
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

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    HStack(spacing: 12) {
                        Text(mode.tabTitle)
                            .font(.largeTitle.bold())

                        Spacer()

                        CloudTargetButton {
                            isTargetPickerPresented = true
                        }
                    }

                    CaptureModeLaunchCard(mode: mode, action: startCapture)

                    ComputerAvailabilityCard {
                        isTargetPickerPresented = true
                    }

                    if mode == .photo {
                        PhotoSessionHistorySection(
                            batches: capturePhotoBatches,
                            onContinue: continuePhotos,
                            onResend: resend,
                            onDelete: delete
                        )

                        PhotoLibraryUploadSection()
                    } else {
                        CaptureModeCapturesSection(
                            mode: mode,
                            results: matchingResults,
                            onResend: resend,
                            onDelete: delete
                        )
                    }
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, 32)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle(mode.tabTitle)
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(
                isPresented: $isCaptureSessionPresented,
                onDismiss: store.endResumedPhotoBatch
            ) {
                CaptureSessionView(
                    isPresented: $isCaptureSessionPresented,
                    mode: mode
                )
            }
            .sheet(isPresented: $isTargetPickerPresented) {
                CloudTargetPickerSheet()
            }
            .onAppear(perform: prepareMode)
        }
    }

    private func prepareMode() {
        store.selectedSection = mode.appSection
        store.activeMode = mode

        guard !hasAppliedScreenshotLaunch,
              ScreenshotScenario.current?.initialCaptureMode == mode,
              ScreenshotScenario.current?.opensCaptureSession == true
        else { return }

        hasAppliedScreenshotLaunch = true
        isCaptureSessionPresented = true
    }

    private func startCapture() {
        store.endResumedPhotoBatch()
        store.clearOcrReview()
        store.activeMode = mode
        isCaptureSessionPresented = true
    }

    private func continuePhotos(in batch: CapturePhotoBatch) {
        store.clearOcrReview()
        store.activeMode = .photo
        store.resumePhotoBatch(id: batch.id)
        isCaptureSessionPresented = true
    }

    private func resend(_ result: ScanResult) {
        Task { await store.insertResultIntoComputer(id: result.id) }
    }

    private func delete(_ result: ScanResult) {
        store.removeResult(id: result.id)
    }
}
