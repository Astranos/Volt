import SwiftUI

struct RootView: View {
    @Environment(ScannerStore.self) private var store
    @State private var selectedTab = AppTab.scan

    var body: some View {
        TabView(selection: $selectedTab) {
            ScannerView(mode: .ocr)
                .tabItem { Label("Scan", systemImage: "viewfinder") }
                .tag(AppTab.scan)

            ScannerView(mode: .barcode)
                .tabItem { Label("Barcode", systemImage: "barcode.viewfinder") }
                .tag(AppTab.barcode)

            ScannerView(mode: .photo)
                .tabItem { Label("Photo", systemImage: "camera") }
                .tag(AppTab.photo)

            DictationView()
                .tabItem { Label("Dictate", systemImage: "mic") }
                .tag(AppTab.dictation)

            ResultsView()
                .tabItem { Label("Results", systemImage: "list.bullet") }
                .tag(AppTab.results)
        }
        .onChange(of: selectedTab) {
            switch selectedTab {
            case .scan:
                store.activeMode = .ocr
            case .barcode:
                store.activeMode = .barcode
            case .photo:
                store.activeMode = .photo
            case .dictation:
                store.activeMode = .dictation
                store.camera.stop()
            case .results:
                store.camera.stop()
            }
        }
    }
}

private enum AppTab: Hashable {
    case scan
    case barcode
    case photo
    case dictation
    case results
}
