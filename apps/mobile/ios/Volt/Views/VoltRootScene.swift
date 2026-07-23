import ClerkKit
import SwiftUI

struct VoltRootScene: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AccessStore.self) private var accessStore
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore

    var body: some View {
        RootView()
            .modifier(
                ClerkImagePrefetchModifier(
                    isEnabled: AppConfiguration.clerkPublishableKey != nil
                )
            )
            .task {
                await subscriptionStore.prepare(using: clerk)
            }
            .task(id: authenticationContext) {
                await refreshAuthenticatedAccess()
            }
    }

    private var authenticationContext: String {
        [clerk.user?.id, clerk.organization?.id]
            .compactMap { $0 }
            .joined(separator: ":")
    }

    private func refreshAuthenticatedAccess() async {
        await accessStore.refresh(using: clerk)
        guard clerk.user != nil else { return }

        await subscriptionStore.refreshCurrentEntitlements(using: clerk)
    }
}
