import SwiftUI

/// The landing surface now represents the scanner as one camera. Mode selection
/// happens inside the presented camera, so a single visit can contain mixed items.
struct UnifiedCaptureHomeView: View {
    @Environment(ScannerStore.self) private var store
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
                    HStack(spacing: 12) {
                        Text("Volt").font(.largeTitle.bold())
                        Spacer()
                        CloudTargetLabel()
                    }
                    UnifiedCaptureLaunchCard(action: startCapture)
                    ComputerAvailabilityCard { isTargetPickerPresented = true }
                    captureHistory
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
            .fullScreenCover(isPresented: $isCaptureSessionPresented, onDismiss: {
                store.endCaptureSession(id: resumedBatchId)
                resumedBatchId = nil
            }) {
                CaptureSessionView(isPresented: $isCaptureSessionPresented, mode: .ocr)
            }
            .sheet(isPresented: $isTargetPickerPresented) { CloudTargetPickerSheet() }
        }
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

    @ViewBuilder
    private var captureHistory: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("History")
                .font(.title2.bold())

            if sessions.isEmpty {
                ContentUnavailableView(
                    "No Scans Yet",
                    systemImage: "camera.viewfinder",
                    description: Text("Your saved scan sessions will appear here.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                ForEach(sessions) { session in
                    CaptureHistorySessionCard(
                        session: session,
                        onResend: { result in Task { await store.insertResultIntoComputer(id: result.id) } },
                        onDelete: { result in store.removeResult(id: result.id) },
                        onContinue: { continueSession(session) }
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
                    PhotoLibraryUploadSection()
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
                        ForEach(sessions) { session in
                            CaptureHistorySessionCard(
                                session: session,
                                onResend: { result in Task { await store.insertResultIntoComputer(id: result.id) } },
                                onDelete: { result in store.removeResult(id: result.id) },
                                onContinue: {
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

    var latestCapturedAt: Date { results.map(\.capturedAt).max() ?? .distantPast }
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

private struct CaptureHistorySessionCard: View {
    let session: CaptureHistorySession
    let onResend: (ScanResult) -> Void
    let onDelete: (ScanResult) -> Void
    let onContinue: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(session.title).font(.headline)
                    Text(session.modeSummary).font(.caption).foregroundStyle(.secondary)
                    Text(session.latestCapturedAt, format: .dateTime.month().day().hour().minute())
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                DeliveryBadge(state: aggregateDeliveryState)
            }
            Button("Continue session", systemImage: "camera.fill", action: onContinue)
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.borderedProminent)
                .tint(VoltBrand.green)
            ForEach(session.results) { result in
                CapturedResultRow(result: result, canResend: true, onResend: { onResend(result) }, onDelete: { onDelete(result) })
                    .padding(12)
                    .background(.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
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
    var body: some View { UnifiedCaptureHomeView() }
}
