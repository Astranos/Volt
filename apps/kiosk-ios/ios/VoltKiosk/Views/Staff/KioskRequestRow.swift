import SwiftUI

struct KioskRequestRow: View {
    let request: KioskProductRequest
    let serverNowMilliseconds: Double
    let isUpdating: Bool
    let error: String?
    let retryStatus: KioskRequestStatus?
    let onUpdate: (KioskRequestStatus) -> Void

    private var waitedMinutes: Int {
        max(0, Int((serverNowMilliseconds - request.createdAt) / 60_000))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 18) {
                productImage
                VStack(alignment: .leading, spacing: 7) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(request.title)
                            .font(.title2.bold())
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        Text(priceText)
                            .font(.title3.bold())
                            .monospacedDigit()
                    }
                    Text(request.variantTitle)
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text(request.sku.map { "SKU \($0)" } ?? "SKU unavailable")
                        .font(.subheadline.monospaced())
                        .foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        statusLabel
                        Text("·")
                        Text(waitText)
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                    .accessibilityElement(children: .combine)
                }
            }

            actionControls

            if let error {
                HStack(alignment: .center, spacing: 12) {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    if let retryStatus {
                        Button("Retry", systemImage: "arrow.clockwise") {
                            onUpdate(retryStatus)
                        }
                        .buttonStyle(.bordered)
                        .frame(minHeight: 44)
                        .disabled(isUpdating)
                    }
                }
                .accessibilityElement(children: .contain)
            }
        }
        .padding(20)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
        }
        .accessibilityIdentifier("request-\(request.id)")
    }

    private var productImage: some View {
        AsyncImage(url: request.imageUrl) { phase in
            if let image = phase.image {
                image.resizable().scaledToFit()
            } else {
                Image(systemName: "photo")
                    .font(.title)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 104, height: 104)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("Photo of \(request.title)")
    }

    private var statusLabel: some View {
        Label(request.status == .waiting ? "Waiting" : "Found", systemImage: request.status == .waiting ? "clock" : "checkmark.circle.fill")
            .foregroundStyle(request.status == .waiting ? Color.orange : Color.green)
    }

    private var waitText: String {
        waitedMinutes == 0 ? "Requested just now" : "Requested \(waitedMinutes) min ago"
    }

    private var priceText: String {
        let amount = Decimal(request.priceCents) / 100
        return amount.formatted(.currency(code: "USD"))
    }

    @ViewBuilder
    private var actionControls: some View {
        if request.status == .waiting {
            HStack(spacing: 12) {
                actionButton("Mark found", systemImage: "checkmark", status: .found, prominent: true)
                actionButton("Clear", systemImage: "xmark", status: .cleared, prominent: false)
            }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    actionButton("Show customer", systemImage: "eye", status: .shown, prominent: true)
                    actionButton("Given", systemImage: "hand.raised.fingers.spread", status: .given, prominent: false)
                    actionButton("Clear", systemImage: "xmark", status: .cleared, prominent: false)
                }
                VStack(spacing: 10) {
                    actionButton("Show customer", systemImage: "eye", status: .shown, prominent: true)
                    HStack(spacing: 12) {
                        actionButton("Given", systemImage: "hand.raised.fingers.spread", status: .given, prominent: false)
                        actionButton("Clear", systemImage: "xmark", status: .cleared, prominent: false)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func actionButton(_ title: String, systemImage: String, status: KioskRequestStatus, prominent: Bool) -> some View {
        let button = Button {
            onUpdate(status)
        } label: {
            Label(title, systemImage: systemImage)
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 48)
                .contentShape(Rectangle())
        }
        if prominent {
            button.buttonStyle(.borderedProminent)
                .disabled(isUpdating)
                .overlay { if isUpdating { ProgressView().controlSize(.small) } }
                .accessibilityHint("Updates this request to \(title.lowercased())")
        } else {
            button.buttonStyle(.bordered)
                .disabled(isUpdating)
                .overlay { if isUpdating { ProgressView().controlSize(.small) } }
                .accessibilityHint("Updates this request to \(title.lowercased())")
        }
    }
}
