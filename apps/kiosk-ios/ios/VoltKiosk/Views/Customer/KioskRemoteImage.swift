import SwiftUI

struct KioskRemoteImage: View {
    let url: URL?
    let title: String

    private var safeURL: URL? { url?.scheme?.lowercased() == "https" ? url : nil }

    var body: some View {
        AsyncImage(url: safeURL) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFit()
            case .empty:
                if safeURL != nil {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    placeholder
                }
            case .failure:
                placeholder
            @unknown default:
                placeholder
            }
        }
        .accessibilityLabel(title)
    }

    private var placeholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "photo").font(.largeTitle)
            Text("Photo unavailable").font(.footnote)
        }
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
