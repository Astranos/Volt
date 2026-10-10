import SwiftUI

struct KioskVariantRequestView: View {
    let product: KioskProduct
    let variant: KioskProduct.Variant
    let session: KioskSession

    private var state: CustomerRequestState { session.requestState(for: variant.id) }
    private var isSending: Bool { if case .sending = state { true } else { false } }
    private var isSent: Bool { if case .sent = state { true } else { false } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    Text(variant.title).font(.headline)
                    Spacer()
                    Text(variant.formattedPrice).font(.title2).bold()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text(variant.title).font(.headline)
                    Text(variant.formattedPrice).font(.title2).bold()
                }
            }
            LabeledContent("SKU", value: variant.sku ?? "Not provided").font(.body)
            if variant.sku != nil { Text("Give this SKU to an associate.").foregroundStyle(.secondary) }
            switch state {
            case .idle:
                requestButton
            case .sending:
                HStack { ProgressView(); Text("Sending your request…").bold() }
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .accessibilityLabel("Sending your request")
            case .sent(let receipt):
                Label(receipt.status.isActive ? "Request sent. An associate will help when available." : "This request has been completed.", systemImage: "checkmark.circle.fill")
                    .font(.headline).foregroundStyle(KioskCustomerStyle.green)
                    .frame(minHeight: 52)
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.circle").foregroundStyle(.red)
                requestButton
            }
        }
        .padding(20)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }

    private var requestButton: some View {
        Button(state == .idle ? "Ask to see this item" : "Try request again", systemImage: "hand.raised", action: request)
            .font(.headline).frame(maxWidth: .infinity, minHeight: 52)
            .buttonStyle(.borderedProminent)
            .foregroundStyle(.white)
            .disabled(!session.canRequest(productID: product.id) || isSending || isSent)
    }

    private func request() {
        session.recordActivity()
        Task { await session.request(product: product, variant: variant) }
    }
}
