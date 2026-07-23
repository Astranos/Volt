import ClerkKit
import StoreKit
import SwiftUI

struct SubscriptionActionsView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AccessStore.self) private var accessStore
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore

    var body: some View {
        Section("Volt Pro") {
            if clerk.user != nil && (accessStore.isRefreshing || !hasCurrentAccessContext) {
                ProgressView("Checking workplace and subscription access…")
            } else if accessStore.status?.access == .complimentary {
                Label("Included with your workplace", systemImage: "building.2.crop.circle.fill")
                    .foregroundStyle(.green)
                Text("This Clerk Organization has complimentary Volt access. No purchase is needed.")
                    .foregroundStyle(.secondary)
            } else if clerk.user == nil {
                Text("Sign in before subscribing so the App Store purchase unlocks the same Clerk account in Volt and Chrome.")
                    .foregroundStyle(.secondary)
            } else {
                Label("Sync scanner results and private photos across Volt on iPhone and Chrome.", systemImage: "icloud.fill")
                    .foregroundStyle(.secondary)
                subscribeButton
                restoreButton
                subscriptionDisclosure
            }

            if let noticeMessage = subscriptionStore.noticeMessage {
                Label(noticeMessage, systemImage: "checkmark.circle")
                    .foregroundStyle(.green)
            }
            if let errorMessage = subscriptionStore.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .accessibilityLabel("Subscription error. \(errorMessage)")
            }
        }
    }

    private var subscribeButton: some View {
        Button(action: purchase) {
            if subscriptionStore.isPurchasing {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 44)
            } else {
                Label(subscribeButtonTitle, systemImage: "bolt.fill")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(subscriptionStore.isPurchasing || accessStore.status?.subscriptionStatus == .active)
        .accessibilityHint("Purchases Volt Pro through the App Store for the signed-in account.")
    }

    private var hasCurrentAccessContext: Bool {
        guard let status = accessStore.status else { return false }
        return status.clerkUserId == clerk.user?.id
            && status.organizationId == clerk.organization?.id
    }

    private var restoreButton: some View {
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

    private var subscriptionDisclosure: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("One-month auto-renewable subscription. Payment is charged to your Apple Account and renews unless canceled at least 24 hours before the current period ends. Manage or cancel in App Store account settings.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            HStack(spacing: 16) {
                Link("Privacy Policy", destination: AppConfiguration.privacyPolicyURL)
                Link("Terms of Use", destination: AppConfiguration.termsOfUseURL)
            }
            .font(.footnote.weight(.semibold))
        }
    }

    private var subscribeButtonTitle: String {
        if accessStore.status?.subscriptionStatus == .active {
            return "Volt Pro Active"
        }
        if let product = subscriptionStore.product {
            return "Subscribe for \(product.displayPrice) per month"
        }
        return "Subscribe for $9 per month"
    }

    private func purchase() {
        Task {
            await subscriptionStore.purchase(using: clerk)
        }
    }

    private func restore() {
        Task {
            await subscriptionStore.restore(using: clerk)
        }
    }
}
