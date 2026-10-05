import SwiftUI

struct KioskPhotoViewer: View {
    let images: [URL]
    let title: String
    @Binding var selectedIndex: Int
    let session: KioskSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if images.isEmpty {
                    ContentUnavailableView("No photos available", systemImage: "photo")
                } else {
                    TabView(selection: $selectedIndex) {
                        ForEach(images.indices, id: \.self) { index in
                            KioskZoomablePhoto(url: images[index], title: "\(title), photo \(index + 1)", session: session)
                            .tag(index)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                    HStack(spacing: 24) {
                        Button("Previous", systemImage: "chevron.left", action: previous)
                            .frame(minHeight: 48).disabled(selectedIndex <= 0)
                        Text("\(selectedIndex + 1) / \(images.count)").font(.headline).monospacedDigit()
                        Button("Next", systemImage: "chevron.right", action: next)
                            .frame(minHeight: 48).disabled(selectedIndex >= images.count - 1)
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.bottom, 16)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", systemImage: "xmark", action: close).frame(minHeight: 44)
                }
            }
            .background(KioskCustomerStyle.background)
        }
        .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { _ in session.recordActivity() })
        .safeAreaInset(edge: .bottom) {
            if let seconds = session.remainingIdleSeconds {
                KioskIdleNotice(seconds: seconds, keepBrowsing: session.recordActivity)
            }
        }
        .tint(KioskCustomerStyle.green)
        .onChange(of: session.resetID) { _, _ in dismiss() }
        .onChange(of: selectedIndex) { _, _ in session.recordActivity() }
    }

    private func previous() { session.recordActivity(); selectedIndex = max(0, selectedIndex - 1) }
    private func next() { session.recordActivity(); selectedIndex = min(images.count - 1, selectedIndex + 1) }
    private func close() { session.recordActivity(); dismiss() }
}
