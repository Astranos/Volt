import SwiftUI

@main
struct VoltClipApp: App {
    @State private var store = ClipScannerStore()

    var body: some Scene {
        WindowGroup {
            ClipRootView(store: store)
                .tint(.green)
                .onOpenURL { url in
                    store.handleIncomingURL(url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL {
                        store.handleIncomingURL(url)
                    }
                }
        }
    }
}
