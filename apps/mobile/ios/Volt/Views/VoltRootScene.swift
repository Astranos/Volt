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
            } else if accessStore.isRefreshing || !hasCurrentAccessContext {
                FullAppAccessLoadingView()
            } else if accessStore.status?.hasFullAppAccess == true {
                RootView()
            } else {
                SubscriptionPaywallView()
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
            .task(id: fullAppAccessContext) {
                await activateCloudWorkspaceIfAuthorized()
            }
    }

    private var authenticationContext: String {
        [clerk.user?.id, clerk.organization?.id]
            .compactMap { $0 }
            .joined(separator: ":")
    }

    private var fullAppAccessContext: String {
        "\(clerk.user?.id ?? "signed-out"):\(accessStore.status?.hasFullAppAccess == true)"
    }

    private var hasCurrentAccessContext: Bool {
        guard let status = accessStore.status else { return false }
        return status.clerkUserId == clerk.user?.id
            && status.organizationId == clerk.organization?.id
    }

    private func refreshAuthenticatedAccess() async {
        await accessStore.refresh(using: clerk)
        guard clerk.user != nil else { return }

        await subscriptionStore.refreshCurrentEntitlements(using: clerk)
    }

    private func activateCloudWorkspaceIfAuthorized() async {
        guard accessStore.status?.hasFullAppAccess == true else {
            scannerStore.cloudWorkspace.setSubscriptionsActive(false)
            return
        }
        await scannerStore.cloudWorkspace.bootstrapIfNeeded(using: clerk)
    }
}

private struct FullAppAccessLoadingView: View {
    var body: some View {
        VStack(spacing: 14) {
            ProgressView()
                .controlSize(.large)
            Text("Checking Volt Pro access…")
                .font(.headline)
            Text("Your App Store subscription and complimentary access are verified securely.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }
}
