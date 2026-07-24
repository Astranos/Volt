import SwiftUI

struct SessionsView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isCaptureSessionPresented = false
    @State private var isTargetPickerPresented = false
    @State private var isUploadPresented = false
    @State private var hasAppliedScreenshotLaunch = false

    private var captureResults: [ScanResult] {
        store.results.filter { $0.source != .upload }
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
                    HStack(spacing: 12) {
                        Text("Sessions")
                            .font(.largeTitle.bold())

                        Spacer()

                        CloudTargetButton {
                            isTargetPickerPresented = true
                        }
                    }

                    SessionUploadCard {
                        isUploadPresented = true
                    }

                    CaptureHistorySection(
                        items: captureHistoryItems,
                        resultCount: captureResults.count,
                        onContinue: continuePhotos,
                        onResend: resend,
                        onDelete: delete
                    )
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, 32)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Sessions")
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(
                isPresented: $isCaptureSessionPresented,
                onDismiss: store.endResumedPhotoBatch
            ) {
                CaptureSessionView(
                    isPresented: $isCaptureSessionPresented,
                    mode: .photo
                )
            }
            .sheet(isPresented: $isTargetPickerPresented) {
                CloudTargetPickerSheet()
            }
            .sheet(isPresented: $isUploadPresented) {
                UploadView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .onAppear(perform: prepareSessions)
            .task {
                await refreshCloudTargetsPeriodically()
            }
        }
    }

    private func prepareSessions() {
        store.selectedSection = .sessions

        guard !hasAppliedScreenshotLaunch,
              ScreenshotScenario.current == .upload
        else { return }

        hasAppliedScreenshotLaunch = true
        isUploadPresented = true
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

    private func refreshCloudTargetsPeriodically() async {
        while !Task.isCancelled {
            await store.cloudWorkspace.refreshComputers()
            await store.refreshDeliveryStatuses()
            try? await Task.sleep(for: .seconds(30))
        }
    }
}

private struct SessionUploadCard: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: "photo.badge.plus")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.green)
                    .frame(width: 48, height: 48)
                    .background(.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text("Upload from Photos")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text("Add existing images to your Volt workspace.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct CaptureHistorySection: View {
    let items: [CaptureHistoryItem]
    let resultCount: Int
    let onContinue: (CapturePhotoBatch) -> Void
    let onResend: (ScanResult) -> Void
    let onDelete: (ScanResult) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Capture History")
                    .font(.headline)
                Spacer()
                Text("\(resultCount)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if items.isEmpty {
                ContentUnavailableView(
                    "No Sessions Yet",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("Text, barcode, and photo captures will appear here.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 34)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(items) { item in
                        switch item {
                        case .photoBatch(let batch):
                            CapturePhotoBatchCard(
                                batch: batch,
                                onContinue: { onContinue(batch) },
                                onResend: onResend,
                                onDelete: onDelete
                            )
                        case .result(let result):
                            CapturedResultRow(
                                result: result,
                                canResend: result.kind != .dictation,
                                onResend: { onResend(result) },
                                onDelete: { onDelete(result) }
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
    let onContinue: () -> Void
    let onResend: (ScanResult) -> Void
    let onDelete: (ScanResult) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(batch.title)
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    Text(batch.latestCapturedAt, format: .dateTime.month().day().hour().minute())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                Button(action: onContinue) {
                    Label("Continue", systemImage: "plus.viewfinder")
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Continue \(batch.title) from \(batch.latestCapturedAt.formatted(date: .abbreviated, time: .shortened))")
            }

            ForEach(batch.results) { result in
                CapturedResultRow(
                    result: result,
                    canResend: true,
                    onResend: { onResend(result) },
                    onDelete: { onDelete(result) }
                )
                .padding(.top, 2)
            }
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
