import SwiftUI

struct KioskListingBlockView: View {
    let block: ListingBlock

    var body: some View {
        switch block {
        case .heading(let text):
            Text(text).font(.title3).bold().accessibilityAddTraits(.isHeader)
        case .paragraph(let text):
            Text(text).font(.body)
        case .list(let items):
            VStack(alignment: .leading, spacing: 10) {
                ForEach(items.indices, id: \.self) { index in
                    HStack(alignment: .top, spacing: 10) {
                        Text("•").accessibilityHidden(true)
                        Text(items[index])
                    }
                }
            }
        case .specifications(let rows):
            VStack(alignment: .leading, spacing: 12) {
                ForEach(rows.indices, id: \.self) { index in
                    LabeledContent {
                        Text(rows[index].value).multilineTextAlignment(.trailing)
                    } label: {
                        Text(rows[index].label).bold()
                    }
                    if index != rows.indices.last { Divider() }
                }
            }
            .padding(16)
            .background(.background, in: RoundedRectangle(cornerRadius: 14))
        }
    }
}
