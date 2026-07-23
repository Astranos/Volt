import SwiftUI

struct ScannerView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isCaptureSessionPresented = false
    @State private var isSessionsPresented = false
    @State private var isTargetPickerPresented = false
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
                    ) {
                        CloudTargetButton {
                            isTargetPickerPresented = true
                        }
                    }

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
            .sheet(isPresented: $isTargetPickerPresented) {
                CloudTargetPickerSheet()
            }
            .onAppear {
                store.selectedSection = .scan
                store.activeMode = ScreenshotScenario.current?.initialCaptureMode ?? .ocr
                if ScreenshotScenario.current?.opensCaptureSession == true {
                    isCaptureSessionPresented = true
                }
            }
            .task {
                await refreshCloudTargetsPeriodically()
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ScannerBottomActionAccessory(
                    title: "Start Capture",
                    systemImage: "doc.viewfinder",
                    isEnabled: true,
                    statusText: captureStatusText,
                    disabledHint: store.targetHint,
                    action: startCapture
                )
            }
        }
    }

    private var captureStatusText: String {
        if let computer = store.cloudWorkspace.selectedComputer {
            "Captures save to Volt and insert into \(computer.label)."
        } else {
            "Captures save on this iPhone. No live computer is required."
        }
    }

    private func startCapture() {
        store.endResumedPhotoBatch()
        store.clearOcrReview()
        store.activeMode = ScreenshotScenario.current?.initialCaptureMode ?? .ocr
        isCaptureSessionPresented = true
    }

    private func addPhotos(to batch: CapturePhotoBatch) {
        store.clearOcrReview()
        store.activeMode = .photo
        store.resumePhotoBatch(id: batch.id)
        isCaptureSessionPresented = true
    }

    private func refreshCloudTargetsPeriodically() async {
        while !Task.isCancelled {
            await store.cloudWorkspace.refreshComputers()
            try? await Task.sleep(for: .seconds(30))
        }
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
                                canAddPhotos: true,
                                onAddPhotos: {
                                    addPhotos(to: batch)
                                },
                                onResend: { result in
                                    Task { await store.insertResultIntoComputer(id: result.id) }
                                },
                                onDelete: { result in
                                    store.removeResult(id: result.id)
                                }
                            )
                        case .result(let result):
                            CapturedResultRow(
                                result: result,
                                canResend: true,
                                onResend: {
                                    Task { await store.insertResultIntoComputer(id: result.id) }
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

struct CloudTargetButton: View {
    @Environment(ScannerStore.self) private var store
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(
                store.cloudWorkspace.selectedComputer?.label ?? "No computer",
                systemImage: store.cloudWorkspace.selectedComputer == nil ? "desktopcomputer.trianglebadge.exclamationmark" : "cursorarrow.motionlines"
            )
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
        }
        .buttonStyle(.bordered)
        .accessibilityHint("Choose an optional computer for cursor insertion.")
    }
}

struct CloudTargetPickerSheet: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    targetButton(
                        title: "No computer",
                        subtitle: "Keep captures in Scanner Results without inserting into a cursor.",
                        systemImage: "nosign",
                        deviceId: nil
                    )
                }

                Section("Online Computers") {
                    if store.cloudWorkspace.availableComputers.isEmpty {
                        ContentUnavailableView(
                            "No Computers Online",
                            systemImage: "desktopcomputer",
                            description: Text("Capture remains available. Open the Volt extension when you want cursor insertion.")
                        )
                    } else {
                        ForEach(store.cloudWorkspace.availableComputers) { computer in
                            targetButton(
                                title: computer.label,
                                subtitle: "Insert accepted barcode and text results",
                                systemImage: "desktopcomputer",
                                deviceId: computer.deviceId
                            )
                        }
                    }
                }
            }
            .navigationTitle("Insert to Computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                await store.cloudWorkspace.refreshComputers()
            }
            .refreshable {
                await store.cloudWorkspace.refreshComputers()
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func targetButton(
        title: String,
        subtitle: String,
        systemImage: String,
        deviceId: String?
    ) -> some View {
        Button {
            Task {
                await store.cloudWorkspace.selectTarget(deviceId: deviceId)
                dismiss()
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .foregroundStyle(.green)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .foregroundStyle(.primary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if store.cloudWorkspace.selectedTargetDeviceId == deviceId {
                    Image(systemName: "checkmark")
                        .font(.headline)
                        .foregroundStyle(.green)
                }
            }
        }
    }
}
