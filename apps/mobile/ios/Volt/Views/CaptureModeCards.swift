import SwiftUI

struct CaptureModeLaunchCard: View {
    let mode: CaptureMode
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: mode.symbolName)
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 68, height: 68)
                    .background(.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 20, style: .continuous))

                VStack(alignment: .leading, spacing: 6) {
                    Text(mode.launchTitle)
                        .font(.title2.bold())
                        .foregroundStyle(.white)

                    Text(mode.launchDescription)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.82))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Label(mode.startActionTitle, systemImage: "arrow.right.circle.fill")
                    .font(.headline)
                    .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(22)
            .background(
                LinearGradient(
                    colors: [mode.accentColor, mode.accentColor.opacity(0.72)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                in: RoundedRectangle(cornerRadius: 24, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the camera in \(mode.title.lowercased()) mode.")
    }
}

struct ComputerAvailabilityCard: View {
    @Environment(ScannerStore.self) private var store
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: "desktopcomputer")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.green)
                    .frame(width: 48, height: 48)
                    .background(.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text(computerTitle)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text(computerSubtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
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
        .accessibilityHint("Shows available computers and changes the typing destination.")
    }

    private var computerTitle: String {
        if let computer = store.cloudWorkspace.selectedComputer {
            return "Typing to \(computer.label)"
        }
        if let computer = store.cloudWorkspace.selectedTargetComputer {
            return "\(computer.label) is offline"
        }
        return "Choose where to type"
    }

    private var computerSubtitle: String {
        let onlineCount = store.cloudWorkspace.availableComputers.count
        if onlineCount == 0 {
            return "No computers are online. Capture still works and syncs to Volt."
        }
        return "\(onlineCount) computer\(onlineCount == 1 ? " is" : "s are") available"
    }
}

/// The captures this tab has taken, newest first, shown in place of a bare saved-item count.
struct CaptureModeCapturesSection: View {
    private let photoColumns = [GridItem(.adaptive(minimum: 96), spacing: 8)]

    let mode: CaptureMode
    /// Newest-first captures of this tab's kind.
    let results: [ScanResult]
    let onResend: (ScanResult) -> Void
    let onDelete: (ScanResult) -> Void

    private var visibleResults: [ScanResult] {
        Array(results.prefix(mode == .photo ? 9 : 5))
    }

    private var hiddenCount: Int {
        max(0, results.count - visibleResults.count)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent \(mode.activityNoun)")
                .font(.headline)

            if results.isEmpty {
                emptyState
            } else if mode == .photo {
                photoGrid
            } else {
                resultRows
            }

            if hiddenCount > 0 {
                Text("\(hiddenCount) more saved")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var emptyState: some View {
        HStack(spacing: 14) {
            Image(systemName: mode.symbolName)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .background(.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            Text("Captures from this session will appear here.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var photoGrid: some View {
        LazyVGrid(columns: photoColumns, spacing: 8) {
            ForEach(visibleResults) { result in
                photoThumbnail(result)
            }
        }
        .padding(12)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func photoThumbnail(_ result: ScanResult) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)

        return Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let imageData = result.imageData, let image = UIImage(data: imageData) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: "photo")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
            }
            .clipShape(shape)
            .overlay {
                shape.stroke(.quaternary, lineWidth: 1)
            }
            .accessibilityLabel("Photo captured at \(result.capturedAt.formatted(date: .omitted, time: .shortened))")
    }

    private var resultRows: some View {
        VStack(spacing: 10) {
            ForEach(visibleResults) { result in
                CapturedResultRow(
                    result: result,
                    canResend: true,
                    onResend: { onResend(result) },
                    onDelete: { onDelete(result) }
                )
                .padding(14)
                .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }
}

extension CaptureMode {
    var appSection: AppSection {
        switch self {
        case .ocr: .text
        case .barcode: .barcode
        case .photo: .photos
        case .dictation: .dictation
        }
    }

    var tabTitle: String {
        switch self {
        case .ocr: "Text"
        case .barcode: "Barcode"
        case .photo: "Photos"
        case .dictation: "Dictate"
        }
    }

    var launchTitle: String {
        switch self {
        case .ocr: "Extract text instantly"
        case .barcode: "Scan a barcode"
        case .photo: "Start a photo session"
        case .dictation: "Dictate to Chrome"
        }
    }

    var launchDescription: String {
        switch self {
        case .ocr:
            "Recognize serial numbers, model numbers, and other text, then send it to your selected computer."
        case .barcode:
            "Scan UPC, QR, and other supported barcode formats and type the value into your selected computer."
        case .photo:
            "Capture a group of product photos, leave when you need to, and continue the same session later."
        case .dictation:
            "Speak with the iPhone microphone and stream live words into the selected Chrome cursor."
        }
    }

    var startActionTitle: String {
        switch self {
        case .ocr: "Scan Text"
        case .barcode: "Scan Barcode"
        case .photo: "Start Photo Session"
        case .dictation: "Start Dictation"
        }
    }

    var activityNoun: String {
        switch self {
        case .ocr: "text captures"
        case .barcode: "barcodes"
        case .photo: "photos"
        case .dictation: "dictation"
        }
    }

    var accentColor: Color {
        switch self {
        case .ocr: .green
        case .barcode: .blue
        case .photo: .indigo
        case .dictation: .orange
        }
    }
}

struct PhotoBatchIdentity: Hashable {
    let batchId: String
    let source: String
}

struct PhotoBatch: Identifiable {
    let batchId: String
    let results: [ScanResult]

    var id: PhotoBatchIdentity {
        PhotoBatchIdentity(batchId: batchId, source: source.rawValue)
    }

    var source: ScanResult.Source {
        results.first?.source ?? .capture
    }

    var latestCapturedAt: Date {
        results.map(\.capturedAt).max() ?? .distantPast
    }

    var title: String {
        let action = source == .upload ? "uploaded" : "captured"
        return "\(results.count) \(action) photo\(results.count == 1 ? "" : "s")"
    }

    var deliveryState: ScanResult.DeliveryState {
        if results.contains(where: { $0.deliveryState == .failed }) {
            return .failed
        }
        if results.contains(where: { $0.deliveryState == .sending }) {
            return .sending
        }
        if results.allSatisfy({ $0.deliveryState == .sent }) {
            return .sent
        }
        return .saved
    }
}

struct PhotoSessionHistorySection: View {
    let batches: [PhotoBatch]
    let onContinue: (PhotoBatch) -> Void
    let onDelete: (ScanResult) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent photos")
                .font(.headline)

            if batches.isEmpty {
                ContentUnavailableView(
                    "No Photos Yet",
                    systemImage: "camera.viewfinder",
                    description: Text("Photo sessions from this tab will appear here.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 34)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(batches) { batch in
                        PhotoBatchCard(
                            batch: batch,
                            onContinue: { onContinue(batch) },
                            onDelete: onDelete,
                            onDeleteBatch: {
                                batch.results.forEach(onDelete)
                            }
                        )
                    }
                }
            }
        }
    }
}

struct PhotoBatchCard: View {
    let batch: PhotoBatch
    let onContinue: () -> Void
    let onDelete: (ScanResult) -> Void
    let onDeleteBatch: () -> Void

    private let columns = [GridItem(.adaptive(minimum: 86), spacing: 8)]

    private var visibleResults: [ScanResult] {
        Array(batch.results.suffix(4))
    }

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

                DeliveryBadge(state: batch.deliveryState)

                Button(role: .destructive, action: onDeleteBatch) {
                    Image(systemName: "trash")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Delete \(batch.title)")
            }

            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(visibleResults) { result in
                    PhotoResultThumbnail(
                        result: result,
                        onDelete: { onDelete(result) }
                    )
                }
            }

            if batch.source == .capture {
                Button(action: onContinue) {
                    Label("Continue Session", systemImage: "plus.viewfinder")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityLabel("Continue \(batch.title) from \(batch.latestCapturedAt.formatted(date: .abbreviated, time: .shortened))")
            }

            if batch.results.count > 4 {
                NavigationLink {
                    PhotoBatchGallery(batch: batch, onDelete: onDelete)
                } label: {
                    Label("View all \(batch.results.count) photos", systemImage: "photo.stack")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct PhotoResultThumbnail: View {
    let result: ScanResult
    let onDelete: () -> Void

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if let imageData = result.imageData, let image = UIImage(data: imageData) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .clipped()
                } else {
                    Image(systemName: "photo")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .background(.secondary.opacity(0.12))
                }

                VStack {
                    HStack {
                        Spacer()
                        Button(role: .destructive, action: onDelete) {
                            Image(systemName: "xmark.circle.fill")
                                .font(.title3)
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.5))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Delete photo")
                    }

                    Spacer()
                }
                .padding(5)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.quaternary, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Photo from \(result.capturedAt.formatted(date: .abbreviated, time: .shortened))")
    }
}

private struct PhotoBatchGallery: View {
    let batch: PhotoBatch
    let onDelete: (ScanResult) -> Void

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 8)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(batch.results) { result in
                    PhotoResultThumbnail(
                        result: result,
                        onDelete: { onDelete(result) }
                    )
                }
            }
            .padding()
        }
        .background(ScannerTabLayout.background)
        .navigationTitle(batch.title.capitalized)
        .navigationBarTitleDisplayMode(.inline)
    }
}
