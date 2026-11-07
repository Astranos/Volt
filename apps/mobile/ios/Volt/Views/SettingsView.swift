import ClerkKit
import ClerkKitUI
import SwiftUI

struct SettingsView: View {
    @Environment(ScannerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let showsDoneButton: Bool

    init(showsDoneButton: Bool = false) {
        self.showsDoneButton = showsDoneButton
    }

    var body: some View {
        @Bindable var store = store

        NavigationStack {
            Form {
                SettingsAccountSection()

                Section {
                    Picker(selection: $store.barcodeRecognitionMode) {
                        ForEach(BarcodeRecognitionMode.allCases) { mode in
                            Text(mode.title)
                                .tag(mode)
                        }
                    } label: {
                        Label("Recognized Codes", systemImage: "barcode.viewfinder")
                    }
                    .pickerStyle(.navigationLink)
                } header: {
                    Text("Scanning")
                } footer: {
                    Text("Captures are kept for 7 days.")
                }

                SubscriptionActionsView()

                Section("About") {
                    Link(destination: AppConfiguration.privacyPolicyURL) {
                        Label {
                            Text("Privacy Policy")
                                .foregroundStyle(Color.primary)
                        } icon: {
                            Image(systemName: "hand.raised")
                        }
                    }

                    LabeledContent {
                        Text(appVersion)
                    } label: {
                        Label("Version", systemImage: "info.circle")
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                if showsDoneButton {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
            .task {
                if !showsDoneButton {
                    store.selectedSection = .settings
                }
            }
        }
    }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "Unknown"
        guard let build = info?["CFBundleVersion"] as? String else { return version }
        return "\(version) (\(build))"
    }
}

/// The signed-in profile and workspace, sitting at the top of Settings instead of behind a sub-screen.
private struct SettingsAccountSection: View {
    private enum AccountSheet: String, Identifiable {
        case profile
        case sessionTasks

        var id: String { rawValue }
    }

    @Environment(Clerk.self) private var clerk
    @State private var presentedSheet: AccountSheet?

    var body: some View {
        if let user = clerk.user {
            Section {
                Button(action: openAccount) {
                    profileRow(for: user)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens your profile, where you can edit your account or sign out.")
                .sheet(item: $presentedSheet) { sheet in
                    switch sheet {
                    case .profile:
                        UserProfileView()
                            .presentationDragIndicator(.visible)
                    case .sessionTasks:
                        AuthView()
                            .presentationDragIndicator(.visible)
                    }
                }

                // Renders nothing when the Clerk instance has organizations turned off.
                OrganizationSwitcher {
                    workspaceRow
                }
            }
        }
    }

    private func profileRow(for user: User) -> some View {
        HStack(spacing: 14) {
            AsyncImage(url: URL(string: user.imageUrl)) { image in
                image
                    .resizable()
                    .scaledToFill()
            } placeholder: {
                Image(systemName: "person.fill")
                    .font(.title3)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.green.gradient)
            }
            .frame(width: 52, height: 52)
            .clipShape(.circle)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(displayName(for: user))
                    .font(.headline)
                    .lineLimit(1)

                if let subtitle = subtitle(for: user) {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            rowChevron
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var workspaceRow: some View {
        HStack(spacing: 8) {
            Label("Workspace", systemImage: "building.2")

            Spacer(minLength: 8)

            Text(clerk.organization?.name ?? "Personal")
                .foregroundStyle(.secondary)
                .lineLimit(1)

            rowChevron
        }
        .frame(minHeight: 36)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var rowChevron: some View {
        Image(systemName: "chevron.right")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
    }

    private func displayName(for user: User) -> String {
        let name = [user.firstName, user.lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if !name.isEmpty { return name }
        return user.primaryEmailAddress?.emailAddress ?? "Your Account"
    }

    /// The email, unless it is already the title because the account has no name.
    private func subtitle(for user: User) -> String? {
        guard let email = user.primaryEmailAddress?.emailAddress,
              email != displayName(for: user)
        else { return nil }
        return email
    }

    private func openAccount() {
        let hasPendingTasks = clerk.session?.tasks?.isEmpty == false
        presentedSheet = hasPendingTasks ? .sessionTasks : .profile
    }
}

struct SettingsSheet: View {
    var body: some View {
        SettingsView(showsDoneButton: true)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
    }
}
