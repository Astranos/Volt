import ClerkKit
import ClerkKitUI
import SwiftUI

struct AccountAccessView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AccessStore.self) private var accessStore

    var body: some View {
        Form {
            accountSection
            workspaceSection
            accessSection
            SubscriptionActionsView()

            if let errorMessage = accessStore.errorMessage {
                Section("Status Error") {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .accessibilityLabel("Access status error. \(errorMessage)")
                    Button("Try Again", systemImage: "arrow.clockwise", action: refreshAccess)
                }
            }
        }
        .navigationTitle("Volt Plan")
        .refreshable {
            await accessStore.refresh(using: clerk)
        }
    }

    private var accountSection: some View {
        Section("Account") {
            UserButton()

            if let user = clerk.user {
                LabeledContent(
                    "Signed in as",
                    value: user.primaryEmailAddress?.emailAddress ?? user.id
                )
            } else {
                Text("Sign in again to access your Volt workspace.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var workspaceSection: some View {
        Section("Workspace") {
            if clerk.user != nil {
                OrganizationSwitcher()
                LabeledContent(
                    "Current",
                    value: clerk.organization?.name ?? accessStore.status?.organizationId ?? "Personal"
                )
            } else {
                LabeledContent("Current", value: "Signed out")
            }
        }
    }

    private var accessSection: some View {
        Section("Plan & Capabilities") {
            if let status = accessStore.status {
                LabeledContent("Plan", value: planLabel(for: status))
                LabeledContent("Local Capture", value: "Included")
                LabeledContent(
                    "Cloud Workspace",
                    value: status.capabilities.cloudWorkspace ? "Included" : "Volt Pro"
                )
                LabeledContent("AI Scans", value: aiScannerLabel(for: status))
                LabeledContent("Subscription", value: subscriptionLabel(for: status))
                if let expiresAt = status.expiresAt {
                    LabeledContent("Renews or Expires") {
                        Text(expiresAt, format: .dateTime.month().day().year())
                    }
                }
            } else if accessStore.isRefreshing {
                ProgressView("Checking Volt access…")
            } else if clerk.user == nil {
                Text("Sign in to check your access.")
                    .foregroundStyle(.secondary)
            } else {
                Text("Pull to refresh your Volt access status.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func planLabel(for status: AccessStatus) -> String {
        if status.access == .complimentary {
            return "Volt Pro · Complimentary"
        }
        return status.plan == .pro ? "Volt Pro" : "Volt Free"
    }

    private func aiScannerLabel(for status: AccessStatus) -> String {
        guard let quota = status.aiScannerQuota else {
            return status.plan == .pro ? "Unlimited" : "Checking…"
        }
        switch quota {
        case .unlimited:
            return "Unlimited"
        case .metered(_, _, let remaining, _):
            return "\(remaining) remaining this month"
        }
    }

    private func subscriptionLabel(for status: AccessStatus) -> String {
        switch status.subscriptionStatus {
        case .none:
            "Not subscribed"
        case .active:
            "Active"
        case .expired:
            "Expired"
        }
    }

    private func refreshAccess() {
        Task {
            await accessStore.refresh(using: clerk)
        }
    }
}
