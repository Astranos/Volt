import SwiftUI

struct KioskStaffBar: View {
    let openSetup: () -> Void
    let openRequests: () -> Void
    let requestsEnabled: Bool

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 16) {
                Label("Staff setup: Start Guided Access before customer use.", systemImage: "lock.open")
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Store setup", systemImage: "gearshape", action: openSetup)
                Button("Staff requests", systemImage: "bell", action: openRequests).disabled(!requestsEnabled)
            }
            VStack(alignment: .leading, spacing: 12) {
                Text("Staff setup: Start Guided Access before customer use.").foregroundStyle(.secondary)
                HStack {
                    Button("Store setup", systemImage: "gearshape", action: openSetup)
                    Button("Staff requests", systemImage: "bell", action: openRequests).disabled(!requestsEnabled)
                }
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .padding(12)
        .background(.regularMaterial)
    }
}
