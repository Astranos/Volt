import SwiftUI

struct KioskCatalogNotice: View {
    let session: KioskSession

    var body: some View {
        if session.isStale || session.errorMessage != nil || session.catalogExpired {
            VStack(alignment: .leading, spacing: 8) {
                Label(session.catalogExpired ? "Inventory update needed" : "Checking availability", systemImage: "exclamationmark.triangle")
                    .font(.headline)
                Text(session.errorMessage ?? "This inventory may be out of date. Requests will be available after a successful refresh.")
                Button("Refresh", systemImage: "arrow.clockwise", action: refresh)
                    .frame(minHeight: 44).disabled(session.isLoading)
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
            .accessibilityElement(children: .contain)
        }
    }

    private func refresh() { session.recordActivity(); Task { await session.refresh() } }
}
