import SwiftUI

struct KioskPrivacyNoticeView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(policy)
                    .font(.body)
                    .frame(maxWidth: 720, alignment: .leading)
                    .padding(24)
                    .frame(maxWidth: .infinity)
            }
            .navigationTitle("Privacy policy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", systemImage: "xmark") { dismiss() }
                }
            }
        }
    }

    private var policy: String {
        guard let url = Bundle.main.url(forResource: "PrivacyNotice", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            return "For privacy questions, contact juanquenga@gmail.com."
        }
        return text
    }
}
