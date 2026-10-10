import SwiftUI

struct KioskPhotoViewer: View {
    let images: [URL]
    let title: String
    @Binding var selectedIndex: Int
    let session: KioskSession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var visibleIndex: Int?

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if images.isEmpty {
                    ContentUnavailableView("No photos available", systemImage: "photo")
                } else {
                    GeometryReader { geometry in
                        let minimumSideInset: CGFloat = images.count > 1 ? min(44, geometry.size.width * 0.12) : 16
                        let photoSize = max(1, min(geometry.size.height, geometry.size.width - minimumSideInset * 2))
                        let sideInset = max(0, (geometry.size.width - photoSize) / 2)
                        ScrollView(.horizontal) {
                            HStack(spacing: 16) {
                                ForEach(images.indices, id: \.self) { index in
                                    KioskZoomablePhoto(url: images[index], title: "\(title), photo \(index + 1)", session: session)
                                        .frame(width: photoSize, height: photoSize)
                                        .background(.white, in: RoundedRectangle(cornerRadius: 16))
                                        .clipShape(RoundedRectangle(cornerRadius: 16))
                                        .id(index)
                                }
                            }
                            .scrollTargetLayout()
                            .frame(height: geometry.size.height)
                        }
                        .contentMargins(.horizontal, sideInset, for: .scrollContent)
                        .scrollTargetBehavior(.viewAligned(limitBehavior: .always))
                        .scrollPosition(id: $visibleIndex)
                        .scrollIndicators(.hidden)
                        .accessibilityHint("Swipe to view another photo.")
                        .overlay(alignment: .leading) {
                            if selectedIndex > 0, sideInset > 16 {
                                peekButton("Previous photo", symbol: "chevron.left", width: sideInset - 16, height: photoSize, action: previous)
                            }
                        }
                        .overlay(alignment: .trailing) {
                            if selectedIndex < images.count - 1, sideInset > 16 {
                                peekButton("Next photo", symbol: "chevron.right", width: sideInset - 16, height: photoSize, action: next)
                            }
                        }
                    }
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
        .onAppear { visibleIndex = min(max(0, selectedIndex), max(0, images.count - 1)) }
        .onChange(of: session.resetID) { _, _ in dismiss() }
        .onChange(of: visibleIndex) { _, index in
            if let index, images.indices.contains(index) {
                selectedIndex = index
            }
        }
        .onChange(of: selectedIndex) { _, index in
            session.recordActivity()
            visibleIndex = index
        }
    }

    private func peekButton(_ label: String, symbol: String, width: CGFloat, height: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Rectangle()
                .fill(.white.opacity(0.001))
                .frame(width: width, height: height)
                .contentShape(Rectangle())
                .overlay {
                    Image(systemName: symbol)
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 28, height: 28)
                        .background(.regularMaterial, in: Circle())
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isButton)
    }

    private func previous() { select(max(0, selectedIndex - 1)) }
    private func next() { select(min(images.count - 1, selectedIndex + 1)) }
    private func select(_ index: Int) {
        session.recordActivity()
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
            selectedIndex = index
            visibleIndex = index
        }
    }
    private func close() { session.recordActivity(); dismiss() }
}
