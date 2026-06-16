import SwiftUI

struct ResultsView: View {
    @Environment(ScannerStore.self) private var store

    var body: some View {
        NavigationStack {
            List(store.results) { result in
                CapturedResultRow(result: result)
                .padding(.vertical, 4)
            }
            .overlay {
                if store.results.isEmpty {
                    ContentUnavailableView("No Results", systemImage: "list.bullet.clipboard")
                }
            }
            .navigationTitle("Results")
        }
    }
}
