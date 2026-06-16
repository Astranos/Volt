import SwiftUI

struct RootView: View {
    @Environment(ScannerStore.self) private var store
    @State private var selectedTab = AppSection.scan

    var body: some View {
        TabView(selection: $selectedTab) {
            ScannerView()
                .tabItem { Label("Capture", systemImage: "camera") }
                .tag(AppSection.scan)

            DictationView()
                .tabItem { Label("Dictate", systemImage: "mic") }
                .tag(AppSection.dictation)

            ResultsView()
                .tabItem { Label("Results", systemImage: "list.bullet") }
                .tag(AppSection.results)
        }
        .onChange(of: selectedTab) { oldValue, newValue in
            applySelectedTab(from: oldValue, to: newValue)
        }
        .task {
            await store.camera.requestAccess()
            applySelectedTab(from: nil, to: selectedTab)
        }
    }

    private func applySelectedTab(from oldTab: AppSection?, to newTab: AppSection) {
        switch newTab {
        case .scan:
            if store.activeMode == .dictation {
                store.activeMode = .ocr
            }
        case .dictation:
            store.activeMode = .dictation
        case .results:
            break
        }

        if newTab == .scan {
            if oldTab != .scan {
                store.camera.start()
            }
        } else if oldTab == .scan {
            store.camera.stop()
        }
    }
}

private enum AppSection: Hashable {
    case scan
    case dictation
    case results
}
