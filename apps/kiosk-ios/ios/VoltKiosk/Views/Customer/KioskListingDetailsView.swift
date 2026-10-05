import SwiftUI

struct KioskListingDetailsView: View {
    let details: [ListingBlock]
    let description: String

    private var sections: (condition: [ListingBlock], main: [ListingBlock]) {
        var condition: [ListingBlock] = []
        var main: [ListingBlock] = []
        var isCondition = false
        for block in details {
            if case .heading(let text) = block {
                let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ":"))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                isCondition = ["cosmetic", "cosmetic condition", "functionality", "functionality condition", "functional condition"].contains(normalized)
            }
            if isCondition { condition.append(block) } else { main.append(block) }
        }
        return (condition, main)
    }

    var body: some View {
        let partition = sections
        VStack(alignment: .leading, spacing: 24) {
            if !partition.condition.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    Label("Item condition", systemImage: "info.circle").font(.title2).bold()
                    ForEach(partition.condition.indices, id: \.self) { index in
                        KioskListingBlockView(block: partition.condition[index])
                    }
                }
                .padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .background(.background, in: RoundedRectangle(cornerRadius: 16))
            }
            Text("Product details").font(.title2).bold().accessibilityAddTraits(.isHeader)
            if details.isEmpty {
                Text(description.isEmpty ? "No additional details provided. Please ask an associate if you have questions." : description)
            } else {
                ForEach(partition.main.indices, id: \.self) { index in
                    KioskListingBlockView(block: partition.main[index])
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
