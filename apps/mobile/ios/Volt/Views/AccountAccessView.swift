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
        .navigationTitle("Volt Access")
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
        Section("Server Access") {
            if let status = accessStore.status {
                LabeledContent("Access", value: accessLabel(for: status))
                LabeledContent("Free Sessions Remaining", value: "\(status.freeSessionsRemaining)")
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

    private func accessLabel(for status: AccessStatus) -> String {
        switch status.access {
        case .trial:
            "Free trial"
        case .complimentary:
            "Complimentary workplace"
        case .subscription:
            "Volt Pro"
        case .exhausted:
            "Subscription required"
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
