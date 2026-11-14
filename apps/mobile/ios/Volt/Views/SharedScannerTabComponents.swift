import PhotosUI
import SwiftUI
import UIKit

enum ScannerTabLayout {
    static let stackSpacing: CGFloat = 18
    static let contentPadding: CGFloat = 20
    static let topPadding: CGFloat = 8
    static let bottomAccessoryContentPadding: CGFloat = 84
    static let primaryActionCornerRadius: CGFloat = 22
    static let disabledPrimaryActionOpacity = 0.68

    static var background: Color {
        Color(.systemGroupedBackground)
    }

    static func primaryActionBackground(isEnabled: Bool) -> Color {
        isEnabled ? .green : .gray
    }
}

struct ScannerConnectionSummary: Equatable {
    let isConnected: Bool
    let isBusy: Bool
    let title: String
    let statusText: String
}

struct PhotoUploadProgress: Identifiable, Equatable {
    enum Phase: Equatable {
        case preparing
        case uploading
        case finished
    }

    let id: String
    let total: Int
    var prepared: Int
    var completed: Int
    var failed: Int
    var phase: Phase

    var finishedCount: Int {
        completed + failed
    }

    var remainingCount: Int {
        max(0, total - finishedCount)
    }

    var fractionCompleted: Double {
        guard total > 0 else { return 0 }
        return min(1, Double(finishedCount) / Double(total))
    }

    var isActive: Bool {
        phase != .finished
    }

    var title: String {
        switch phase {
        case .preparing:
            "Preparing \(min(prepared + 1, total)) of \(total)"
        case .uploading:
            "Uploading \(min(finishedCount + 1, total)) of \(total)"
        case .finished:
            failed > 0 ? "Uploaded \(completed) of \(total)" : "Uploaded \(total) photo\(total == 1 ? "" : "s")"
        }
    }

    var detail: String {
        if failed > 0 {
            return "\(completed) sent, \(failed) failed, \(remainingCount) left"
        }
        switch phase {
        case .preparing:
            return "\(prepared) ready, \(max(0, total - prepared)) left to prepare"
        case .uploading:
            return "\(completed) sent, \(remainingCount) left"
        case .finished:
            return "All uploads finished"
        }
    }
}

struct PhotoPreparationProgressSummary: View {
    let prepared: Int
    let total: Int

    private var readCount: Int {
        guard total > 0 else { return 0 }
        return min(max(prepared, 1), total)
    }

    private var fractionCompleted: Double {
        guard total > 0 else { return 0 }
        return min(1, Double(prepared) / Double(total))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label("Reading \(readCount) of \(total) photos", systemImage: "hourglass")
                    .font(.headline)

                Spacer(minLength: 10)

                Text("\(prepared)/\(total)")
                    .font(.subheadline.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            ProgressView(value: fractionCompleted)
                .tint(.green)

            Text("Preparing selected photos for upload")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

struct PhotoUploadProgressSummary: View {
    let progress: PhotoUploadProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label(progress.title, systemImage: progress.isActive ? "arrow.up.circle" : "checkmark.circle.fill")
                    .font(.headline)
                    .foregroundStyle(progress.failed > 0 ? .orange : .primary)

                Spacer(minLength: 10)

                Text("\(progress.finishedCount)/\(progress.total)")
                    .font(.subheadline.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            ProgressView(value: progress.fractionCompleted)
                .tint(progress.failed > 0 ? .orange : .green)

            Text(progress.detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

struct ScannerChromeSectionHeader<TrailingAccessory: View>: View {
    let title: String
    let connection: ScannerConnectionSummary
    let onConnectionControlTapped: () -> Void
    @ViewBuilder let trailingAccessory: () -> TrailingAccessory

    init(
        title: String,
        connection: ScannerConnectionSummary,
        onConnectionControlTapped: @escaping () -> Void,
        @ViewBuilder trailingAccessory: @escaping () -> TrailingAccessory
    ) {
        self.title = title
        self.connection = connection
        self.onConnectionControlTapped = onConnectionControlTapped
        self.trailingAccessory = trailingAccessory
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title)
                .font(.largeTitle.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .frame(maxWidth: .infinity, alignment: .leading)

            trailingAccessory()

            connectionControl
        }
        .accessibilityElement(children: .contain)
    }

    private var connectionControl: some View {
        Button(action: onConnectionControlTapped) {
            HStack(spacing: 8) {
                if connection.isBusy {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.primary)
                } else {
                    Image(systemName: connection.isConnected ? "checkmark.circle.fill" : "desktopcomputer")
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
        .accessibilityLabel(connection.isConnected ? "Connected. Open sessions." : "Connect. Open sessions.")
        .accessibilityHint(connection.statusText)
    }

    private var connectionColor: Color {
        if connection.isConnected {
            return .green
        }
        return .secondary
    }
}

extension ScannerChromeSectionHeader where TrailingAccessory == EmptyView {
    init(
        title: String,
        connection: ScannerConnectionSummary,
        onConnectionControlTapped: @escaping () -> Void
    ) {
        self.init(title: title, connection: connection, onConnectionControlTapped: onConnectionControlTapped) {
            EmptyView()
        }
    }
}

struct ScannerBottomActionAccessory: View {
    let title: String
    let systemImage: String
    let isEnabled: Bool
    var isConnecting = false
    let statusText: String
    let disabledHint: String
    let action: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text(statusText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)

            Button(action: action) {
                Label(actionTitle, systemImage: actionSystemImage)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(
                        ScannerTabLayout.primaryActionBackground(isEnabled: isEnabled),
                        in: RoundedRectangle(cornerRadius: ScannerTabLayout.primaryActionCornerRadius, style: .continuous)
                    )
                    .opacity(isEnabled ? 1 : ScannerTabLayout.disabledPrimaryActionOpacity)
                    .shadow(color: .black.opacity(0.16), radius: 10, y: 5)
            }
            .buttonStyle(.plain)
            .disabled(!isEnabled)
            .accessibilityHint(isEnabled ? "" : disabledHint)
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
        .shadow(color: .black.opacity(0.12), radius: 10, y: -3)
    }

    private var actionTitle: String {
        isConnecting ? "Connecting..." : title
    }

    private var actionSystemImage: String {
        isConnecting ? "hourglass" : systemImage
    }
}

/// The home screen's floating bar: photo import, the one primary Start action, and settings.
/// The typing target lives in the header chip, so the bar no longer repeats it.
struct ScannerHomeControls: View {
    static let reservedSpace: CGFloat = 74

    let onScan: () -> Void
    @Binding var photoSelection: [PhotosPickerItem]
    let onSettings: () -> Void
    var isPhotoPickerEnabled = true
    var isScanSelected = true
    var isSettingsSelected = false

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 12) {
                controls
            }
            .padding(.top, 10)
            .frame(maxWidth: .infinity)
            .shadow(color: .black.opacity(0.24), radius: 12, y: 6)
        } else {
            controls
                .padding(.top, 10)
                .frame(maxWidth: .infinity)
                .background(.ultraThinMaterial)
                .shadow(color: .black.opacity(0.18), radius: 10, y: 5)
        }
    }

    private var controls: some View {
        HStack(spacing: 12) {
            photosButton
            scanButton
            settingsButton
        }
    }

    private var photosButton: some View {
        PhotosPicker(selection: $photoSelection, maxSelectionCount: 30, matching: .images) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.subheadline.weight(.semibold))
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .rootTabBarGlass(isSelected: false)
        .disabled(!isPhotoPickerEnabled)
        .accessibilityLabel("Add Photos")
        .accessibilityHint("Imports photos from your library into Donut")
    }

    private var scanButton: some View {
        Button(action: onScan) {
            Label("Start", systemImage: "camera.viewfinder")
                .font(.headline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .rootTabBarScanStyle()
        .tint(.green)
        .accessibilityLabel("Start")
        .accessibilityHint("Starts the scanner")
        .accessibilityAddTraits(isScanSelected ? .isSelected : [])
    }

    private var settingsButton: some View {
        Button {
            onSettings()
        } label: {
            Label("Settings", systemImage: "gearshape")
                .labelStyle(.iconOnly)
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .foregroundStyle(isSettingsSelected ? .primary : .secondary)
        .rootTabBarGlass(isSelected: isSettingsSelected)
        .accessibilityLabel("Settings")
        .accessibilityHint("Shows app settings")
        .accessibilityAddTraits(isSettingsSelected ? .isSelected : [])
    }
}

/// The single place the home screen shows where captures go. A status dot carries
/// online/offline so the separate "Typing to" card isn't needed.
struct HomeTargetChip: View {
    enum Status {
        case ready
        case warning
        case idle
        case busy
        case failed

        var color: Color {
            switch self {
            case .ready: .green
            case .warning: .orange
            case .idle, .busy: .secondary
            case .failed: .red
            }
        }
    }

    let title: String
    let systemImage: String
    let status: Status
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if status == .busy {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: systemImage)
                        .font(.subheadline.weight(.semibold))
                        .overlay(alignment: .bottomTrailing) {
                            Circle()
                                .fill(status.color)
                                .frame(width: 8, height: 8)
                                .overlay(Circle().stroke(Color(.secondarySystemGroupedBackground), lineWidth: 1.5))
                                .offset(x: 3, y: 2)
                        }
                }
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            // Card colour rather than `.background`, which matches the page in dark mode.
            .background(Color(.secondarySystemGroupedBackground), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Choose where captures are sent")
        .accessibilityIdentifier("home-target-chip")
    }
}

/// Home header: wordmark on the left, target chip on the right.
struct ScannerHomeHeader: View {
    let chip: HomeTargetChip

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("Donut")
                .font(.largeTitle.bold())
                .frame(maxWidth: .infinity, alignment: .leading)
            chip
        }
    }
}

/// "Today", "Yesterday", then a short weekday date, for grouping history by day.
func historyDayTitle(for date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
    if calendar.isDate(date, inSameDayAs: now) { return "Today" }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
       calendar.isDate(date, inSameDayAs: yesterday) {
        return "Yesterday"
    }
    let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
    return sameYear
        ? date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        : date.formatted(.dateTime.month(.abbreviated).day().year())
}

/// Groups already-sorted (newest first) items into consecutive day sections.
func historyDaySections<Item>(_ items: [Item], date: (Item) -> Date) -> [(title: String, items: [Item])] {
    var sections: [(title: String, items: [Item])] = []
    for item in items {
        let title = historyDayTitle(for: date(item))
        if sections.last?.title == title {
            sections[sections.count - 1].items.append(item)
        } else {
            sections.append((title, [item]))
        }
    }
    return sections
}

/// Section label above a day's sessions.
struct HistoryDayHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.headline)
            .foregroundStyle(.secondary)
            .padding(.top, 4)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Shows import progress only while there is something to report, so the home screen
/// doesn't carry a permanent photo-library section.
struct PhotoImportStatusBanner: View {
    let isPreparing: Bool
    let prepared: Int
    let total: Int
    let progress: PhotoUploadProgress?
    let message: String?
    let isError: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if isPreparing {
                PhotoPreparationProgressSummary(prepared: prepared, total: total)
            } else if let progress {
                PhotoUploadProgressSummary(progress: progress)
            }
            if let message {
                Label(message, systemImage: isError ? "exclamationmark.triangle.fill" : "info.circle")
                    .font(.footnote)
                    .foregroundStyle(isError ? .red : .secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    var isVisible: Bool { isPreparing || progress != nil || message != nil }
}

private struct RootTabBarGlassModifier: ViewModifier {
    let isSelected: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.buttonStyle(
                .glass(.regular.tint(isSelected ? .accentColor.opacity(0.16) : .clear))
            )
            .buttonBorderShape(.circle)
        } else {
            content
                .buttonStyle(.bordered)
                .buttonBorderShape(.circle)
                .tint(isSelected ? .accentColor : .secondary)
        }
    }
}

private struct RootTabBarScanStyleModifier: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.buttonStyle(.glassProminent)
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}

private extension View {
    func rootTabBarGlass(isSelected: Bool) -> some View {
        modifier(RootTabBarGlassModifier(isSelected: isSelected))
    }

    func rootTabBarScanStyle() -> some View {
        modifier(RootTabBarScanStyleModifier())
    }
}

/// What a history row shows for one capture: the label ("Serial", "UPC", "Text"…), an icon,
/// the value to display, and whether it is a single identifier (shown monospaced on one line).
struct HistoryCaptureClassification {
    enum Kind { case text, barcode, photo, dictation }

    let label: String
    let symbol: String
    let displayValue: String
    let isIdentifier: Bool

    init(kind: Kind, value: String, format: String) {
        switch kind {
        case .text:
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            // Only when the whole capture is one identifier; a block of label text stays "Text".
            if !trimmed.contains(where: \.isNewline),
               let match = LiveTextIdentifierMatcher.match(trimmed),
               match.value.count >= trimmed.count - 1 {
                label = match.kind.rawValue
                symbol = "number"
                displayValue = match.value
                isIdentifier = true
            } else {
                label = "Text"
                symbol = "text.alignleft"
                displayValue = value
                isIdentifier = false
            }
        case .barcode:
            let upper = format.uppercased()
            label = upper.contains("UPC") ? "UPC" : upper.contains("EAN") ? "EAN" : upper.contains("QR") ? "QR code" : "Barcode"
            symbol = "barcode"
            displayValue = value
            isIdentifier = true
        case .photo:
            label = "Photo"
            symbol = "photo"
            displayValue = value
            isIdentifier = false
        case .dictation:
            label = "Dictation"
            symbol = "mic"
            displayValue = value
            isIdentifier = false
        }
    }
}

enum HistoryCaptureStatus {
    case sent
    case sending
    case failed
    /// Saved locally, not sent yet; shows a send button.
    case unsent
}

/// One capture in history, shared by the app and the App Clip. The value is the headline;
/// tap copies; long-press has Copy / Send / Delete, so there is no always-visible trash can.
/// The trailing icon is the delivery state and doubles as send/retry when unsent or failed.
struct HistoryCaptureRow<Leading: View>: View {
    let classification: HistoryCaptureClassification
    let copyText: String
    let capturedAt: Date
    let status: HistoryCaptureStatus
    let statusDescription: String
    let sendTitle: String
    let canSend: Bool
    let onSend: () -> Void
    var onDelete: (() -> Void)?
    @ViewBuilder let leading: () -> Leading
    @State private var copyCount = 0
    @State private var showsCopied = false

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            leading()

            VStack(alignment: .leading, spacing: 2) {
                Text(classification.label.uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(0.4)
                    .foregroundStyle(.secondary)
                Text(classification.displayValue)
                    .font(classification.isIdentifier ? .body.monospaced().weight(.medium) : .callout)
                    .foregroundStyle(.primary)
                    .lineLimit(classification.isIdentifier ? 1 : 3)
                    .minimumScaleFactor(classification.isIdentifier ? 0.7 : 1)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 4) {
                Text(capturedAt, format: .dateTime.hour().minute())
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                statusView
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture(perform: copy)
        .sensoryFeedback(.success, trigger: copyCount)
        .contextMenu {
            Button("Copy", systemImage: "doc.on.doc", action: copy)
            Button(sendTitle, systemImage: "paperplane", action: onSend)
                .disabled(!canSend)
            if let onDelete {
                Divider()
                Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(classification.label), \(classification.displayValue), \(statusDescription)")
        .accessibilityHint("Tap to copy. Touch and hold for more actions.")
        .accessibilityAction(named: "Copy", copy)
        .accessibilityAction(named: sendTitle, onSend)
        .accessibilityAction(named: "Delete") { onDelete?() }
    }

    @ViewBuilder
    private var statusView: some View {
        if showsCopied {
            Label("Copied", systemImage: "checkmark")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.green)
                .transition(.opacity)
        } else {
            switch status {
            case .sent:
                Image(systemName: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.green)
            case .sending:
                ProgressView().controlSize(.mini)
            case .failed:
                statusButton(symbol: "exclamationmark.arrow.circlepath", color: .red)
            case .unsent:
                statusButton(symbol: "paperplane", color: .green)
            }
        }
    }

    private func statusButton(symbol: String, color: Color) -> some View {
        Button(action: onSend) {
            Image(systemName: symbol)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(color)
                .frame(minWidth: 32, minHeight: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .accessibilityLabel(sendTitle)
    }

    private func copy() {
        UIPasteboard.general.string = copyText
        copyCount += 1
        withAnimation { showsCopied = true }
        let current = copyCount
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            if copyCount == current { withAnimation { showsCopied = false } }
        }
    }
}

/// The tinted icon tile used at the start of a history row.
struct HistoryCaptureIcon: View {
    let symbol: String
    let color: Color

    var body: some View {
        Image(systemName: symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(color)
            .frame(width: 40, height: 40)
            .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}
