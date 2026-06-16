import SwiftUI

@main
struct VoltApp: App {
    @State private var scannerStore = ScannerStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(scannerStore)
                .tint(.green)
                .onOpenURL { url in
                    scannerStore.handleIncomingURL(url)
                }
        }
    }
}
