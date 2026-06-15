import SwiftUI

struct ResultsView: View {
    @Environment(ScannerStore.self) private var store

    var body: some View {
        NavigationStack {
            List(store.results) { result in
                VStack(alignment: .leading, spacing: 6) {
                    Label(result.kind.rawValue.capitalized, systemImage: symbol(for: result.kind))
                        .font(.headline)
                    Text(result.value)
                        .font(.body)
                        .textSelection(.enabled)
                    Text(result.format)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
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

    private func symbol(for kind: ScanResult.Kind) -> String {
        switch kind {
        case .barcode: "barcode"
        case .text: "doc.text"
        case .photo: "photo"
        case .dictation: "mic"
        }
    }
}
