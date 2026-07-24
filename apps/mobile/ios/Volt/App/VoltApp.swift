import ClerkKit
import SwiftUI

@main
struct VoltApp: App {
    @State private var scannerStore = ScannerStore()
    @State private var accessStore: AccessStore
    @State private var subscriptionStore: StoreKitSubscriptionStore
    private let clerk: Clerk

    init() {
        Clerk.configure(publishableKey: AppConfiguration.clerkPublishableKey)
        clerk = Clerk.shared

        let accessStore = AccessStore(
            apiClient: MobileAccessAPIClient(baseURL: AppConfiguration.convexSiteURL)
        )
        _accessStore = State(initialValue: accessStore)
        _subscriptionStore = State(
            initialValue: StoreKitSubscriptionStore(
                productID: AppConfiguration.storeKitProductID,
                accessStore: accessStore
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if ProcessInfo.processInfo.environment["VOLT_SUBSCRIPTION_REVIEW_SCREENSHOT"] == "1" {
                    SubscriptionReviewScreenshotView()
                } else {
                    VoltRootScene()
                        .environment(scannerStore)
                        .environment(accessStore)
                        .environment(subscriptionStore)
                        .environment(clerk)
                }
            }
                .tint(.green)
                .onOpenURL { url in
                    handleIncomingURL(url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL {
                        handleIncomingURL(url)
                    }
                }
        }
    }

    private func handleIncomingURL(_ url: URL) {
        Task { @MainActor in
            do {
                try await clerk.handle(url)
            } catch {
                accessStore.reportAuthenticationError(error)
            }
        }
    }
}
