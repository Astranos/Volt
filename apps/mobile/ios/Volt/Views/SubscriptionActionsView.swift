import ClerkKit
import SwiftUI

/// Volt is free, so this only shows for accounts with an old App Store subscription. Those
/// customers keep restore and cancellation; see docs/authentication.md.
struct SubscriptionActionsView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AccessStore.self) private var accessStore
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore

    var body: some View {
        if let subscriptionStatus {
            Section {
                Button(action: restore) {
                    if subscriptionStore.isRestoring {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        rowLabel("Restore Purchases", systemImage: "arrow.clockwise")
                    }
                }
                .disabled(subscriptionStore.isRestoring)

                if let appStoreSubscriptionsURL {
                    Link(destination: appStoreSubscriptionsURL) {
                        rowLabel("Manage Subscription", systemImage: "creditcard")
                    }
                }

                if let noticeMessage = subscriptionStore.noticeMessage {
                    Label(noticeMessage, systemImage: "checkmark.circle")
                        .foregroundStyle(.green)
                }
                if let errorMessage = subscriptionStore.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                        .accessibilityLabel("Purchase status error. \(errorMessage)")
                }
            } header: {
                Text("App Store")
            } footer: {
                if subscriptionStatus == .active {
                    Text("Donut is free now, so you can cancel your old subscription.")
                }
            }
        }
    }

    private func rowLabel(_ title: String, systemImage: String) -> some View {
        Label {
            Text(title)
                .foregroundStyle(Color.primary)
        } icon: {
            Image(systemName: systemImage)
        }
    }

    /// Set only when this signed-in account has an active or expired App Store purchase.
    private var subscriptionStatus: VoltSubscriptionStatus? {
        guard let status = accessStore.status,
              status.clerkUserId == clerk.user?.id,
              status.organizationId == clerk.organization?.id,
              status.subscriptionStatus == .active || status.subscriptionStatus == .expired
        else { return nil }
        return status.subscriptionStatus
    }

    private var appStoreSubscriptionsURL: URL? {
        URL(string: "https://apps.apple.com/account/subscriptions")
    }

    private func restore() {
        Task {
            await subscriptionStore.restore(using: clerk)
        }
    }
}
