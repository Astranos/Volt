import SwiftUI

struct ResultsView: View {
    @Environment(ScannerStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.results) { result in
                    CapturedResultRow(
                        result: result,
                        onDelete: {
                            store.removeResult(id: result.id)
                        }
                    )
                    .padding(.vertical, 4)
                }
                .onDelete { offsets in
                    store.removeResults(at: offsets)
                }
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
