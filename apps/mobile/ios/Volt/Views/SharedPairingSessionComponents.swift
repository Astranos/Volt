import SwiftUI

struct PairingSessionSetupContent: View {
    private let webScannerURLText = "volt-scanner.vercel.app/session"

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Scan the QR code from the Chrome extension, or open the session page on your computer. This iPhone will connect to that browser session.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                PairingSessionSetupStep(
                    systemImage: "desktopcomputer",
                    title: "Open Volt on your computer",
                    detail: "Use the Chrome extension side panel, or enter the URL below."
                )
                PairingSessionSetupStep(
                    systemImage: "qrcode",
                    title: "Show the pairing QR",
                    detail: "Start pairing in Chrome or on the session page."
                )
                PairingSessionSetupStep(
                    systemImage: "iphone",
                    title: "Scan the QR with this iPhone",
                    detail: "Tap Scan Computer QR below."
                )
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Session page")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)

                Text(webScannerURLText)
                    .font(.system(.callout, design: .monospaced).weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
                    .textSelection(.enabled)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(.green.opacity(0.22), lineWidth: 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PairingSessionSetupStep: View {
    let systemImage: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.headline.weight(.semibold))
                .foregroundStyle(.green)
                .frame(width: 32, height: 32)
                .background(.green.opacity(0.10), in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PairingScanControls: View {
    let statusText: String
    let statusDetail: String
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Label("Scan Pairing QR", systemImage: "qrcode.viewfinder")
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)

            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(statusText)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                    Text(statusDetail)
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.66))
                        .lineLimit(2)
                }

                Spacer(minLength: 12)

                Button("Finish", systemImage: "xmark", action: onFinish)
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                    .frame(minHeight: 44)
                    .padding(.horizontal, 14)
                    .background(.black.opacity(0.54), in: Capsule())
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 22)
        .background {
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.78), .black.opacity(0.94)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        }
    }
}
