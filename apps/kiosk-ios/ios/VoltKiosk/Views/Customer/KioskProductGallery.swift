import SwiftUI

struct KioskProductGallery: View {
    let images: [URL]
    let title: String
    let session: KioskSession
    @State private var selectedIndex = 0
    @State private var showingViewer = false

    private var safeIndex: Int { min(selectedIndex, max(images.count - 1, 0)) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: openViewer) {
                KioskRemoteImage(url: images.isEmpty ? nil : images[safeIndex], title: title)
                    .padding(12)
                    .aspectRatio(1, contentMode: .fit)
                    .frame(maxWidth: 344)
                    .background(.white, in: RoundedRectangle(cornerRadius: 20))
                    .overlay(alignment: .bottomTrailing) {
                        if !images.isEmpty {
                            Label("View photos", systemImage: "arrow.up.left.and.arrow.down.right")
                                .font(.subheadline).bold().padding(10)
                                .background(.regularMaterial, in: Capsule()).padding(12)
                        }
                    }
            }
            .buttonStyle(.plain).disabled(images.isEmpty)
            .accessibilityLabel("View photos of \(title)")
            if images.count > 1 {
                ScrollView(.vertical) {
                    VStack(spacing: 10) {
                        ForEach(images.indices, id: \.self) { index in
                            Button { select(index) } label: {
                                KioskRemoteImage(url: images[index], title: "Photo \(index + 1)")
                                    .frame(width: 68, height: 68).padding(4)
                                    .background(.white, in: RoundedRectangle(cornerRadius: 12))
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(index == safeIndex ? KioskCustomerStyle.green : .clear, lineWidth: 3))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Photo \(index + 1) of \(images.count)")
                            .accessibilityAddTraits(index == safeIndex ? [.isSelected] : [])
                        }
                    }
                    .padding(3)
                }
                .frame(width: 82, height: 320)
                .scrollIndicators(.hidden)
                .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { _ in session.recordActivity() })
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .fullScreenCover(isPresented: $showingViewer) {
            KioskPhotoViewer(images: images, title: title, selectedIndex: $selectedIndex, session: session)
        }
        .onChange(of: session.resetID) { _, _ in showingViewer = false }
        .onChange(of: images) { _, _ in selectedIndex = 0 }
    }

    private func openViewer() { session.recordActivity(); showingViewer = !images.isEmpty }
    private func select(_ index: Int) { session.recordActivity(); selectedIndex = index }
}
