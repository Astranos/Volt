import ClerkKit
import ClerkKitUI
import StoreKit
import SwiftUI

struct SubscriptionPaywallView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AccessStore.self) private var accessStore
    @Environment(StoreKitSubscriptionStore.self) private var subscriptionStore

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                HStack {
                    Spacer()
                    UserButton()
                }

                VStack(spacing: 16) {
                    Image("VoltLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 76, height: 76)
                        .accessibilityHidden(true)

                    Text("Volt Pro")
                        .font(.largeTitle.bold())

                    Text("Try every scanner workflow free, then keep your iPhone and Chrome workspace in sync with one monthly subscription.")
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

                VStack(spacing: 12) {
                    Button(action: purchase) {
                        if subscriptionStore.isPurchasing {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 48)
                        } else {
                            Label(subscriptionStore.purchaseButtonTitle, systemImage: "bolt.fill")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 48)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(subscriptionStore.isPurchasing)
                    .accessibilityHint("Starts the App Store subscription for this Volt account.")

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

                    Text(subscriptionStore.purchaseDisclosure)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

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
                if let errorMessage = subscriptionStore.errorMessage ?? accessStore.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.footnote)
                }
            }
            .padding(24)
            .padding(.bottom, 24)
        }
        .background(Color(.secondarySystemBackground))
        .tint(VoltBrand.green)
    }

    private func purchase() {
        Task { await subscriptionStore.purchase(using: clerk) }
    }

    private func restore() {
        Task { await subscriptionStore.restore(using: clerk) }
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
            Text(subscriptionStore.purchaseDisclosure + " Manage or cancel in App Store account settings.")
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
        subscriptionStore.purchaseButtonTitle
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
