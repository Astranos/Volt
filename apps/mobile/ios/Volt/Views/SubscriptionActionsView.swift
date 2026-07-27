import ClerkKit
import ClerkKitUI
import StoreKit
import SwiftUI

/// Apple requires the purchase screen to state the subscription title, its length, its
/// price, and to link the privacy policy and Terms of Use (Guideline 3.1.2(c)).
/// `SubscriptionStoreView` renders the title, length, and price straight from StoreKit,
/// and the policy destinations below supply the two required links.
struct SubscriptionPaywallView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AccessStore.self) private var accessStore
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore

    var body: some View {
        SubscriptionStoreView(productIDs: [AppConfiguration.storeKitProductID]) {
            PaywallMarketingContent()
        }
        .subscriptionStoreControlStyle(.prominentPicker)
        .subscriptionStoreButtonLabel(.multiline)
        .storeButton(.visible, for: .restorePurchases, .policies)
        .subscriptionStorePolicyDestination(
            url: AppConfiguration.privacyPolicyURL,
            for: .privacyPolicy
        )
        .subscriptionStorePolicyDestination(
            url: AppConfiguration.termsOfUseURL,
            for: .termsOfService
        )
        .inAppPurchaseOptions { _ in
            await subscriptionStore.purchaseOptions(using: clerk)
        }
        .onInAppPurchaseCompletion { _, result in
            await subscriptionStore.completePurchase(result, using: clerk)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            PaywallStatusBanner(
                noticeMessage: subscriptionStore.noticeMessage,
                errorMessage: subscriptionStore.errorMessage ?? accessStore.errorMessage,
                isVerifying: subscriptionStore.isPurchasing
            )
        }
        .tint(VoltBrand.green)
    }
}

private struct PaywallMarketingContent: View {
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore

    var body: some View {
        VStack(spacing: 24) {
            HStack {
                Spacer()
                UserButton()
            }

            VStack(spacing: 14) {
                Image("VoltLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 76, height: 76)
                    .accessibilityHidden(true)

                Text("Volt Pro")
                    .font(.largeTitle.bold())

                Text("Keep your iPhone scanner and Chrome workspace in sync with one auto-renewing subscription.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 18) {
                PaywallFeature(
                    title: "Capture without limits",
                    detail: "Scan text and barcodes, capture product photos, and upload from Photos.",
                    systemImage: "viewfinder"
                )
                PaywallFeature(
                    title: "Sync across Volt",
                    detail: "Keep captures available in your private workspace on iPhone and Chrome.",
                    systemImage: "icloud.fill"
                )
                PaywallFeature(
                    title: "Type into your computer",
                    detail: "Send text and barcode results to the computer you select.",
                    systemImage: "desktopcomputer"
                )
            }
            .padding(20)
            .background(.background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))

            VStack(spacing: 6) {
                if let planSummary = subscriptionStore.planSummary {
                    Text(planSummary)
                        .font(.footnote.weight(.semibold))
                }
                Text(subscriptionStore.renewalDisclosure)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
    }
}

private struct PaywallStatusBanner: View {
    let noticeMessage: String?
    let errorMessage: String?
    let isVerifying: Bool

    private var hasContent: Bool {
        isVerifying || noticeMessage != nil || errorMessage != nil
    }

    @ViewBuilder
    var body: some View {
        if hasContent {
            VStack(spacing: 8) {
                if isVerifying {
                    Label {
                        Text("Verifying your purchase…")
                    } icon: {
                        ProgressView()
                    }
                }
                if let noticeMessage {
                    Label(noticeMessage, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
            }
            .font(.footnote)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.horizontal, 20)
        }
    }
}

private struct PaywallFeature: View {
    let title: String
    let detail: String
    let systemImage: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: systemImage)
                .font(.title3.weight(.semibold))
                .foregroundStyle(VoltBrand.green)
                .frame(width: 34)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct SubscriptionActionsView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AccessStore.self) private var accessStore
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore
    @State private var isPresentingPaywall = false

    var body: some View {
        Section("Volt Pro") {
            if clerk.user != nil && (accessStore.isRefreshing || !hasCurrentAccessContext) {
                ProgressView("Checking workplace and subscription access…")
            } else if accessStore.status?.access == .complimentary {
                Label("Complimentary Volt Pro access", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)
                Text("This account has unlimited access. No App Store purchase is needed.")
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
        .sheet(isPresented: $isPresentingPaywall) {
            NavigationStack {
                SubscriptionPaywallView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { isPresentingPaywall = false }
                        }
                    }
            }
        }
    }

    /// Purchases always run through `SubscriptionPaywallView`, the single screen that
    /// states the subscription title, length, and price alongside the policy links.
    private var subscribeButton: some View {
        Button {
            isPresentingPaywall = true
        } label: {
            Label("See Volt Pro Plan", systemImage: "bolt.fill")
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
        .disabled(accessStore.status?.subscriptionStatus == .active)
        .accessibilityHint("Opens the Volt Pro purchase screen with subscription length, price, and policy links.")
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
            if let planSummary = subscriptionStore.planSummary {
                Text(planSummary)
                    .font(.footnote.weight(.semibold))
            }

            Text(subscriptionStore.renewalDisclosure)
                .font(.footnote)
                .foregroundStyle(.secondary)

            HStack(spacing: 16) {
                Link("Privacy Policy", destination: AppConfiguration.privacyPolicyURL)
                Link("Terms of Use", destination: AppConfiguration.termsOfUseURL)
            }
            .font(.footnote.weight(.semibold))
        }
    }

    private func restore() {
        Task {
            await subscriptionStore.restore(using: clerk)
        }
    }
}
