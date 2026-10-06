import SwiftUI

struct KioskZoomablePhoto: View {
    let url: URL
    let title: String
    let session: KioskSession
    @State private var zoom: CGFloat = 1
    @State private var initialZoom: CGFloat = 1
    private let maximumZoom: CGFloat = 4

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                if zoom > 1 {
                    ScrollView([.horizontal, .vertical]) {
                        KioskRemoteImage(url: url, title: title)
                            .frame(width: geometry.size.width * zoom, height: geometry.size.height * zoom)
                    }
                    .defaultScrollAnchor(.center)
                    .scrollIndicators(.hidden)
                    .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { _ in session.recordActivity() })
                } else {
                    KioskRemoteImage(url: url, title: title)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                }
            }
            .contentShape(Rectangle())
            .simultaneousGesture(
                MagnifyGesture()
                    .onChanged { value in updateZoom(value.magnification) }
                    .onEnded { _ in finishZoom() }
            )
            .accessibilityValue("Zoom \(Int(zoom * 100)) percent")
            .accessibilityHint("Pinch to zoom. Swipe to pan while zoomed.")
            .accessibilityAdjustableAction(adjustZoom)
            .overlay(alignment: .topTrailing) {
                if zoom > 1 {
                    Button("Reset zoom", systemImage: "arrow.counterclockwise", action: resetZoom)
                        .font(.headline).frame(minHeight: 44).padding(.horizontal, 12)
                        .background(.regularMaterial, in: Capsule()).padding(12)
                }
            }
        }
    }

    private func updateZoom(_ magnification: CGFloat) {
        session.recordActivity()
        zoom = min(maximumZoom, max(1, initialZoom * magnification))
    }

    private func finishZoom() { session.recordActivity(); initialZoom = zoom }
    private func resetZoom() { session.recordActivity(); zoom = 1; initialZoom = 1 }

    private func adjustZoom(_ direction: AccessibilityAdjustmentDirection) {
        session.recordActivity()
        switch direction {
        case .increment: zoom = min(maximumZoom, zoom + 0.5)
        case .decrement: zoom = max(1, zoom - 0.5)
        @unknown default: break
        }
        initialZoom = zoom
    }
}
