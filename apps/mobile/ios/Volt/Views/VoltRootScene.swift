import ClerkKit
import ClerkKitUI
import SwiftUI

struct VoltRootScene: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AccessStore.self) private var accessStore
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore
    @Environment(ScannerStore.self) private var scannerStore

    var body: some View {
        Group {
            if ScreenshotScenario.isEnabled {
                RootView()
            } else if clerk.user == nil {
                AuthenticationLandingView()
            } else {
                RootView()
            }
        }
            .environment(\.clerkTheme, VoltBrand.clerkTheme)
            .clerkAppIcon(Image("VoltLogo"))
            .clerkAppIcon(maxHeight: 56)
            .modifier(
                ClerkImagePrefetchModifier(
                    isEnabled: true
                )
            )
            .task {
                await subscriptionStore.prepare(using: clerk)
            }
            .task(id: authenticationContext) {
                await refreshAuthenticatedAccess()
            }
            .task(id: cloudWorkspaceContext) {
                await configureCloudWorkspace()
            }
    }

    private var authenticationContext: String {
        [clerk.user?.id, clerk.organization?.id]
            .compactMap { $0 }
            .joined(separator: ":")
    }

    private var cloudWorkspaceContext: String {
        "\(clerk.user?.id ?? "signed-out"):\(accessStore.status?.capabilities.cloudWorkspace == true)"
    }

    private func refreshAuthenticatedAccess() async {
        await accessStore.refresh(using: clerk)
        guard clerk.user != nil else { return }

        await subscriptionStore.refreshCurrentEntitlements(using: clerk)
    }

    private func configureCloudWorkspace() async {
        guard clerk.user != nil else {
            scannerStore.cloudWorkspace.setCloudWorkspaceEnabled(false)
            scannerStore.cloudWorkspace.setSubscriptionsActive(false)
            return
        }
        scannerStore.cloudWorkspace.setCloudWorkspaceEnabled(false)
        await scannerStore.cloudWorkspace.bootstrapIfNeeded(using: clerk)
        scannerStore.cloudWorkspace.setCloudWorkspaceEnabled(
            accessStore.status?.capabilities.cloudWorkspace == true
        )
    }
}
