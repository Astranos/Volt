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

    @ViewBuilder
    var body: some View {
        // `SubscriptionStoreView` replaces its whole body with "Subscription Unavailable"
        // when StoreKit returns no product, which would strand the reviewer on a blank
        // screen with no policy links and no way to sign out.
        if subscriptionStore.isProductUnavailable {
            PaywallUnavailableView()
        } else {
            storeView
        }
    }

    private var storeView: some View {
        SubscriptionStoreView(productIDs: [AppConfiguration.storeKitProductID]) {
            PaywallMarketingContent()
        }
        .subscriptionStoreControlStyle(GlassSubscriptionControlStyle())
        // The glass control style supplies its own Restore Purchases button and policy
        // links, so StoreKit's flat versions would only duplicate them.
        .storeButton(.hidden, for: .restorePurchases, .policies)
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

/// StoreKit's built-in subscription controls render flat buttons that skip the Liquid
/// Glass press animation used everywhere else in Volt. A custom control style lets the
/// buttons be ordinary SwiftUI ones while `option.subscribe()` keeps the purchase running
/// through `SubscriptionStoreView`, so `inAppPurchaseOptions` and
/// `onInAppPurchaseCompletion` still apply.
private struct GlassSubscriptionControlStyle: SubscriptionStoreControlStyle {
    func makeBody(configuration: Configuration) -> some View {
        GlassSubscriptionControls(options: configuration.options)
    }
}

private struct GlassSubscriptionControls: View {
    let options: [SubscriptionStoreControlStyleConfiguration.Option]

    @Environment(Clerk.self) private var clerk
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore

    var body: some View {
        VStack(spacing: 12) {
            ForEach(options) { option in
                Button {
                    option.subscribe()
                } label: {
                    VStack(spacing: 2) {
                        Text(actionTitle(for: option))
                            .font(.headline)
                        Text(StoreKitSubscriptionStore.purchaseCaption(
                            for: option.subscription,
                            activeOffer: option.activeOffer
                        ))
                        .font(.caption)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .tint(VoltBrand.green)
            }

            Button {
                Task { await subscriptionStore.restore(using: clerk) }
            } label: {
                if subscriptionStore.isRestoring {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Restore Purchases")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.glass)
            .controlSize(.large)
            .disabled(subscriptionStore.isRestoring)

            // Guideline 3.1.2(c) wants both policy links functional on the purchase
            // screen. StoreKit's own `.policies` row sits in the scrolling content, where
            // the bottom bar covers it until the reviewer scrolls, so Volt draws the links
            // here instead — pinned beside the buttons and visible the moment the sheet
            // opens.
            // `.plain` is load-bearing: a Link inherits the prominent button style from
            // the surrounding store controls and would otherwise render as a third and
            // fourth full-width call to action.
            HStack(spacing: 18) {
                Link("Terms of Use", destination: AppConfiguration.termsOfUseURL)
                Link("Privacy Policy", destination: AppConfiguration.privacyPolicyURL)
            }
            .buttonStyle(.plain)
            .font(.footnote.weight(.medium))
            .foregroundStyle(VoltBrand.green)
            .padding(.top, 2)
        }
        .padding(.horizontal, 20)
    }

    private func actionTitle(
        for option: SubscriptionStoreControlStyleConfiguration.Option
    ) -> String {
        option.activeOffer?.paymentMode == .freeTrial ? "Try It Free" : "Subscribe"
    }
}

/// Shown when StoreKit cannot supply the product. Keeps the account controls, the
/// policy links, and Restore Purchases reachable instead of the store view's bare
/// "Subscription Unavailable" placeholder.
private struct PaywallUnavailableView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                PaywallMarketingContent()

                VStack(spacing: 12) {
                    Label("Volt Pro is not available from the App Store right now", systemImage: "exclamationmark.triangle.fill")
                        .font(.headline)
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.center)

                    Text("The App Store did not return the Volt Pro subscription for this account's storefront. Try again in a moment, or restore a purchase you already made.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)

                    Button {
                        Task { await subscriptionStore.reloadProduct() }
                    } label: {
                        if subscriptionStore.isLoadingProduct {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 48)
                        } else {
                            Label("Try Again", systemImage: "arrow.clockwise")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 48)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(subscriptionStore.isLoadingProduct)

                    Button {
                        Task { await subscriptionStore.restore(using: clerk) }
                    } label: {
                        if subscriptionStore.isRestoring {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            Label("Restore Purchases", systemImage: "arrow.clockwise.circle")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                    }
                    .disabled(subscriptionStore.isRestoring)

                    HStack(spacing: 20) {
                        Link("Privacy Policy", destination: AppConfiguration.privacyPolicyURL)
                        Link("Terms of Use", destination: AppConfiguration.termsOfUseURL)
                    }
                    .font(.footnote.weight(.semibold))
                }

                if let noticeMessage = subscriptionStore.noticeMessage {
                    Label(noticeMessage, systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.footnote)
                }
                if let errorMessage = subscriptionStore.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.footnote)
                }
            }
            .padding(.bottom, 32)
        }
        .background(Color(.secondarySystemBackground))
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

                // Guideline 3.1.2(c) wants the title, length, and price stated in the app.
                // Keep them directly under the headline so they are on screen the moment
                // the paywall lands, without scrolling past the feature list.
                if let planSummary = subscriptionStore.planSummary {
                    Text(planSummary)
                        .font(.subheadline.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
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

            Text(subscriptionStore.renewalDisclosure)
                .font(.footnote)
                .foregroundStyle(.secondary)
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
            .voltGlassSurface(cornerRadius: 14)
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
