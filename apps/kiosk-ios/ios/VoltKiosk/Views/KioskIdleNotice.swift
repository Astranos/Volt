import SwiftUI

struct KioskIdleNotice: View {
    let seconds: Int
    let keepBrowsing: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text("Still looking?").font(.headline)
                Text("Starting fresh in \(seconds) seconds.").foregroundStyle(.secondary)
            }
            Spacer()
            Button("Keep browsing", action: keepBrowsing)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .padding(16)
        .background(.regularMaterial)
    }
}
