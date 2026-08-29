import ClerkKit
import SwiftUI

struct AccessSettingsSection: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AccessStore.self) private var accessStore

    var body: some View {
        Section("Access") {
            LabeledContent("Account", value: accountLabel)
            LabeledContent("Workspace", value: workspaceLabel)
            LabeledContent("Plan", value: planLabel)
            LabeledContent("Cloud Workspace", value: cloudWorkspaceLabel)
            LabeledContent("AI Scans", value: aiScannerLabel)
            LabeledContent("Subscription", value: subscriptionLabel)

            NavigationLink("Account & Subscription") {
                AccountAccessView()
            }
        }
    }

    private var accountLabel: String {
        clerk.user?.primaryEmailAddress?.emailAddress
            ?? (clerk.user == nil ? "Not signed in" : "Signed in")
    }

    private var workspaceLabel: String {
        clerk.organization?.name
            ?? accessStore.status?.organizationId
            ?? (clerk.user == nil ? "Chrome trial" : "Personal")
    }

    private var planLabel: String {
        guard clerk.user != nil else { return "Sign in required" }
        guard let status = accessStore.status else { return accessStore.isRefreshing ? "Checking…" : "Unavailable" }
        return status.plan == .pro ? "Volt Pro" : "Volt Free"
    }

    private var cloudWorkspaceLabel: String {
        guard clerk.user != nil else { return "Sign in required" }
        guard let status = accessStore.status else { return accessStore.isRefreshing ? "Checking…" : "Unavailable" }
        return status.capabilities.cloudWorkspace ? "Included" : "Volt Pro"
    }

    private var aiScannerLabel: String {
        guard clerk.user != nil else { return "Sign in required" }
        guard let status = accessStore.status else { return accessStore.isRefreshing ? "Checking…" : "Unavailable" }
        guard let quota = status.aiScannerQuota else { return status.plan == .pro ? "Unlimited" : "Checking…" }
        switch quota {
        case .unlimited:
            return "Unlimited"
        case .metered(_, _, let remaining, _):
            return "\(remaining) remaining this month"
        }
    }

    private var subscriptionLabel: String {
        guard clerk.user != nil else { return "Sign in to subscribe" }
        guard let status = accessStore.status else { return accessStore.isRefreshing ? "Checking…" : "Unavailable" }

        if status.access == .complimentary {
            return "Included by workplace"
        }
        switch status.subscriptionStatus {
        case .active:
            return "Active"
        case .expired:
            return "Expired"
        case .none:
            return "Not subscribed"
        }
    }
}
