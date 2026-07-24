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

struct CaptureModeActivityCard: View {
    let mode: CaptureMode
    let count: Int

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "clock")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 44, height: 44)
                .background(.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text("Saved \(mode.activityNoun)")
                    .font(.headline)
                Text("\(count) in Sessions")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

extension CaptureMode {
    var appSection: AppSection {
        switch self {
        case .ocr: .text
        case .barcode: .barcode
        case .photo: .photos
        case .dictation: .sessions
        }
    }

    var tabTitle: String {
        switch self {
        case .ocr: "Text"
        case .barcode: "Barcode"
        case .photo: "Photos"
        case .dictation: "Sessions"
        }
    }

    var launchTitle: String {
        switch self {
        case .ocr: "Extract text instantly"
        case .barcode: "Scan a barcode"
        case .photo: "Start a photo session"
        case .dictation: "Capture"
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
            "Capture information with Volt."
        }
    }

    var startActionTitle: String {
        switch self {
        case .ocr: "Scan Text"
        case .barcode: "Scan Barcode"
        case .photo: "Start Photo Session"
        case .dictation: "Start Capture"
        }
    }

    var activityNoun: String {
        switch self {
        case .ocr: "text captures"
        case .barcode: "barcodes"
        case .photo: "photos"
        case .dictation: "captures"
        }
    }

    var accentColor: Color {
        switch self {
        case .ocr: .green
        case .barcode: .blue
        case .photo: .indigo
        case .dictation: .green
        }
    }
}
