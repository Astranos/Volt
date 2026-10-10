import ClerkKit
import SwiftUI

struct SubscriptionActionsView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AccessStore.self) private var accessStore
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore

    var body: some View {
        Section("Existing App Store purchases") {
            if clerk.user == nil {
                Text("Sign in to restore a purchase linked to your Volt account.")
                    .foregroundStyle(.secondary)
            } else if accessStore.isRefreshing || !hasCurrentAccessContext {
                ProgressView("Checking purchase status…")
            } else {
                Text(subscriptionSummary)
                    .foregroundStyle(.secondary)
            }

            if clerk.user != nil {
                Button(action: restore) {
                    if subscriptionStore.isRestoring {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label("Restore Purchases", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .disabled(subscriptionStore.isRestoring)
            }

            if hasStoreKitHistory, let appStoreSubscriptionsURL {
                Link("Manage in App Store", destination: appStoreSubscriptionsURL)
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
        }
    }

    private var hasCurrentAccessContext: Bool {
        guard let status = accessStore.status else { return false }
        return status.clerkUserId == clerk.user?.id
            && status.organizationId == clerk.organization?.id
    }

    private var appStoreSubscriptionsURL: URL? {
        URL(string: "https://apps.apple.com/account/subscriptions")
    }

    private var hasStoreKitHistory: Bool {
        guard hasCurrentAccessContext,
              let subscriptionStatus = accessStore.status?.subscriptionStatus
        else { return false }
        return subscriptionStatus == .active || subscriptionStatus == .expired
    }

    private var subscriptionSummary: String {
        switch accessStore.status?.subscriptionStatus {
        case .some(.active):
            "An active App Store purchase is linked to this account."
        case .some(.expired):
            "A previous App Store purchase has expired."
        case .some(.none), nil:
            "Restore an App Store purchase linked to this account."
        }
    }

    private func restore() {
        Task {
            await subscriptionStore.restore(using: clerk)
        }
    }
}
