import SwiftUI
import UIKit

enum PortalLoadState: Equatable {
    case loading
    case ready
    case failed
}

struct KioskView: View {
    @State private var loadState = PortalLoadState.loading
    @State private var retryID = 0
    @State private var guidedAccessEnabled = UIAccessibility.isGuidedAccessEnabled

    private let policy: PortalNavigationPolicy? = {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "KioskPortalURL") as? String,
              let url = URL(string: value),
              let policy = PortalNavigationPolicy(portalURL: url),
              let domains = Bundle.main.object(forInfoDictionaryKey: "WKAppBoundDomains") as? [String],
              domains.contains(where: { $0.lowercased() == url.host?.lowercased() }) else {
            return nil
        }
        return policy
    }()

    var body: some View {
        Group {
            if let policy {
                ZStack {
                    PortalWebView(policy: policy, loadState: $loadState, retryID: retryID)

                    if loadState == .loading {
                        ProgressView("Loading catalog…")
                            .padding(24)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                            .allowsHitTesting(false)
                    } else if loadState == .failed {
                        ContentUnavailableView {
                            Label("Catalog unavailable", systemImage: "wifi.exclamationmark")
                        } description: {
                            Text("Check the iPad’s internet connection, then try again.")
                        } actions: {
                            Button("Try again") {
                                loadState = .loading
                                retryID += 1
                            }
                                .buttonStyle(.borderedProminent)
                                .accessibilityIdentifier("retryPortal")
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(uiColor: .systemBackground))
                    }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if !guidedAccessEnabled {
                        Text("Staff setup: Enable Guided Access in Settings → Accessibility, then triple-click the top or Home button to lock this iPad into the kiosk.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(12)
                            .frame(maxWidth: .infinity)
                            .background(.regularMaterial)
                    }
                }
            } else {
                ContentUnavailableView("Portal configuration missing", systemImage: "gearshape", description: Text("Ask staff to check the app’s bundled portal URL and allowed domain."))
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.guidedAccessStatusDidChangeNotification)) { _ in
            guidedAccessEnabled = UIAccessibility.isGuidedAccessEnabled
        }
        .persistentSystemOverlays(.hidden)
    }
}
