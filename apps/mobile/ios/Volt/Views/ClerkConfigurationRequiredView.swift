import SwiftUI

struct ClerkConfigurationRequiredView: View {
    var body: some View {
        ContentUnavailableView {
            Label("Clerk Configuration Required", systemImage: "person.crop.circle.badge.exclamationmark")
        } description: {
            Text("Set VOLT_CLERK_PUBLISHABLE_KEY before running the full Volt app. Authentication and subscriptions stay disabled until Clerk is configured.")
        }
        .padding()
    }
}
