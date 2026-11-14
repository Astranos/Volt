import PhotosUI
import SwiftUI

/// The landing surface now represents the scanner as one camera. Mode selection
/// happens inside the presented camera, so a single visit can contain mixed items.
struct UnifiedCaptureHomeView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var photoSelection: [PhotosPickerItem]
    @State private var isCaptureSessionPresented = false
    @State private var isTargetPickerPresented = false
    @State private var resumedBatchId: String?

    private var sessions: [CaptureHistorySession] {
        captureHistorySessions(from: store.results)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ScannerHomeHeader(chip: targetChip)
                    PhotoLibraryUploadSection(selectedItems: $photoSelection) {
                        if sessions.isEmpty {
                            // First run: explain the camera once. After that, Start in the bar is enough.
                            UnifiedCaptureLaunchCard(action: startCapture)
                        } else {
                            captureHistory
                        }
                    }
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, 32)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Donut")
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $isCaptureSessionPresented, onDismiss: {
                store.endCaptureSession(id: resumedBatchId)
                resumedBatchId = nil
            }) {
                CaptureSessionView(isPresented: $isCaptureSessionPresented, mode: .ocr)
            }
            .sheet(isPresented: $isTargetPickerPresented) { CloudTargetPickerSheet() }
        }
    }

    private var targetChip: HomeTargetChip {
        let label = CloudTargetLabel.targetLabel(for: store)
        let (systemImage, status, description): (String, HomeTargetChip.Status, String) =
            if store.cloudWorkspace.selectedComputer != nil {
                ("desktopcomputer", .ready, "Typing to \(label)")
            } else if store.cloudWorkspace.selectedTargetComputer != nil {
                ("desktopcomputer", .warning, "\(label) is offline")
            } else {
                ("iphone", .idle, "Saving to this iPhone")
            }
        return HomeTargetChip(
            title: label,
            systemImage: systemImage,
            status: status,
            accessibilityLabel: description
        ) { isTargetPickerPresented = true }
    }

    private func startCapture() {
        resumedBatchId = nil
        store.clearOcrReview()
        store.beginCaptureSession()
        isCaptureSessionPresented = true
    }

    private func continueSession(_ session: CaptureHistorySession) {
        store.clearOcrReview()
        resumedBatchId = store.resumeCaptureSession(batchId: session.id)
        isCaptureSessionPresented = true
    }

    private var captureHistory: some View {
        CaptureHistorySessionList(
            sessions: sessions,
            onResend: { result in Task { await store.insertResultIntoComputer(id: result.id) } },
            onDelete: { result in store.removeResult(id: result.id) },
            onContinue: continueSession
        )
    }
}

/// History sessions grouped under Today / Yesterday / date headers.
private struct CaptureHistorySessionList: View {
    let sessions: [CaptureHistorySession]
    let onResend: (ScanResult) -> Void
    let onDelete: (ScanResult) -> Void
    let onContinue: (CaptureHistorySession) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(historyDaySections(sessions, date: \.latestCapturedAt), id: \.title) { section in
                HistoryDayHeader(title: section.title)
                ForEach(section.items) { session in
                    CaptureHistorySessionCard(
                        session: session,
                        onResend: onResend,
                        onDelete: onDelete,
                        onContinue: { onContinue(session) }
                    )
                }
            }
        }
    }
}

private struct UnifiedCaptureLaunchCard: View {
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
                    Text("Start a scan session")
                        .font(.title2.bold())
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
                LinearGradient(
                    colors: [.green, .green.opacity(0.68)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                in: RoundedRectangle(cornerRadius: 24, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the unified camera with Text selected.")
    }
}

/// Unified history grouped by the same batch ID assigned to every capture in a
/// presented camera session. Missing IDs remain singletons for legacy records.
struct CaptureHistoryView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var photoSelection: [PhotosPickerItem]
    @State private var isTargetPickerPresented = false
    @State private var isCaptureSessionPresented = false
    @State private var resumedBatchId: String?

    private var sessions: [CaptureHistorySession] {
        captureHistorySessions(from: store.results)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    HStack {
                        Text("History").font(.largeTitle.bold())
                        Spacer()
                        CloudTargetButton { isTargetPickerPresented = true }
                    }
                    PhotoLibraryUploadSection(selectedItems: $photoSelection) {
                        if sessions.isEmpty {
                            ContentUnavailableView(
                                "No Scans Yet",
                                systemImage: "camera.viewfinder",
                                description: Text("Text, barcodes, photos, and audio from each camera session will appear here.")
                            )
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 34)
                            .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        } else {
                            CaptureHistorySessionList(
                                sessions: sessions,
                                onResend: { result in Task { await store.insertResultIntoComputer(id: result.id) } },
                                onDelete: { result in store.removeResult(id: result.id) },
                                onContinue: { session in
                                    store.clearOcrReview()
                                    resumedBatchId = store.resumeCaptureSession(batchId: session.id)
                                    isCaptureSessionPresented = true
                                }
                            )
                        }
                    }
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, 32)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("History")
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $isTargetPickerPresented) { CloudTargetPickerSheet() }
            .fullScreenCover(isPresented: $isCaptureSessionPresented, onDismiss: {
                store.endCaptureSession(id: resumedBatchId)
                resumedBatchId = nil
            }) {
                CaptureSessionView(isPresented: $isCaptureSessionPresented, mode: .ocr)
            }
            .onAppear { store.selectedSection = .photos }
        }
    }
}

private func captureHistorySessions(from results: [ScanResult]) -> [CaptureHistorySession] {
    Dictionary(grouping: results) { result in
        result.batchId ?? result.id.uuidString.lowercased()
    }
    .map { CaptureHistorySession(id: $0.key, results: $0.value.sorted { $0.capturedAt < $1.capturedAt }) }
    .sorted { $0.latestCapturedAt > $1.latestCapturedAt }
}

struct CaptureHistorySession: Identifiable {
    let id: String
    let results: [ScanResult]

    // Only adjacent photos collapse: text, barcode, audio and source changes
    // remain chronological boundaries inside a mixed capture session.
    var entries: [CaptureHistoryEntry] {
        var entries: [CaptureHistoryEntry] = []
        for result in results {
            if result.kind == .photo {
                if case .photos(let batch) = entries.last,
                   batch.source == result.source {
                    entries[entries.count - 1] = .photos(
                        PhotoBatch(batchId: id, results: batch.results + [result])
                    )
                } else {
                    entries.append(.photos(PhotoBatch(batchId: id, results: [result])))
                }
            } else {
                entries.append(.result(result))
            }
        }
        return entries
    }

    var latestCapturedAt: Date { results.map(\.capturedAt).max() ?? .distantPast }
    var earliestCapturedAt: Date { results.map(\.capturedAt).min() ?? .distantPast }

    /// "1:05 PM", or a localized range like "12:52 – 1:05 PM" when the session spans minutes.
    var timeRange: String {
        guard latestCapturedAt.timeIntervalSince(earliestCapturedAt) >= 60 else {
            return latestCapturedAt.formatted(date: .omitted, time: .shortened)
        }
        return (earliestCapturedAt..<latestCapturedAt).formatted(.interval.hour().minute())
    }
    var title: String { "\(results.count) capture\(results.count == 1 ? "" : "s")" }

    var modeSummary: String {
        var modes: [CaptureMode] = []
        for result in results {
            let mode: CaptureMode = switch result.kind {
            case .text: .ocr
            case .barcode: .barcode
            case .photo: .photo
            case .dictation: .dictation
            }
            if !modes.contains(mode) { modes.append(mode) }
        }
        return modes.map(\.title).joined(separator: " · ")
    }
}

enum CaptureHistoryEntry: Identifiable {
    case result(ScanResult)
    case photos(PhotoBatch)

    var id: UUID {
        switch self {
        case .result(let result): result.id
        case .photos(let batch): batch.results[0].id
        }
    }
}

private struct CaptureHistorySessionCard: View {
    let session: CaptureHistorySession
    let onResend: (ScanResult) -> Void
    let onDelete: (ScanResult) -> Void
    let onContinue: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(session.title).font(.headline)
                Spacer()
                DeliveryBadge(state: aggregateDeliveryState)
            }
            HStack(alignment: .center, spacing: 8) {
                Text("\(session.modeSummary) · \(session.timeRange)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                // Secondary to the bar's Start button, so tinted rather than filled.
                Button("Continue", systemImage: "camera.fill", action: onContinue)
                    .font(.subheadline.weight(.semibold))
                    .accessibilityLabel("Continue session")
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                    .tint(VoltBrand.green)
            }
            VStack(spacing: 0) {
                ForEach(Array(session.entries.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 {
                        Divider().padding(.leading, 64)
                    }
                    switch entry {
                    case .photos(let batch):
                        CaptureHistoryPhotoBatch(batch: batch, onResend: onResend, onDelete: onDelete)
                    case .result(let result):
                        CapturedResultRow(result: result, canResend: true, onResend: { onResend(result) }, onDelete: { onDelete(result) })
                    }
                }
            }
            .background(Color(.tertiarySystemGroupedBackground).opacity(0.6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var aggregateDeliveryState: ScanResult.DeliveryState {
        if session.results.contains(where: { $0.deliveryState == .failed }) { return .failed }
        if session.results.contains(where: { $0.deliveryState == .sending }) { return .sending }
        if session.results.allSatisfy({ $0.deliveryState == .sent }) { return .sent }
        return .saved
    }
}

/// Compatibility wrapper for screenshot fixtures and old callers.
struct CaptureModeTabView: View {
    @State private var photoSelection: [PhotosPickerItem] = []
    var body: some View { UnifiedCaptureHomeView(photoSelection: $photoSelection) }
}
