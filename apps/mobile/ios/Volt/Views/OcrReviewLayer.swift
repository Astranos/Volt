import SwiftUI

struct OcrReviewLayer: View {
    let image: UIImage
    let regions: [RecognizedTextRegion]
    let selectedRegion: RecognizedTextRegion?
    let onSelectRegion: (RecognizedTextRegion) -> Void
    @State private var baseScale: CGFloat = 1
    @State private var gestureScale: CGFloat = 1
    @State private var baseOffset: CGSize = .zero
    @State private var gestureOffset: CGSize = .zero
    @State private var isMagnifying = false

    private var currentScale: CGFloat {
        min(max(baseScale * gestureScale, 1), 4)
    }

    private var currentOffset: CGSize {
        currentScale > 1
            ? CGSize(width: baseOffset.width + gestureOffset.width, height: baseOffset.height + gestureOffset.height)
            : .zero
    }

    var body: some View {
        GeometryReader { proxy in
            let imageRect = aspectFitRect(for: image.size, in: proxy.size)

            ZStack {
                Color.black

                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                ForEach(regions) { region in
                    let rect = viewRect(for: region.boundingBox, in: imageRect)

                    RoundedRectangle(cornerRadius: max(4, min(rect.height * 0.22, 10)), style: .continuous)
                        .fill(fillStyle(for: region))
                        .overlay {
                            RoundedRectangle(cornerRadius: max(4, min(rect.height * 0.22, 10)), style: .continuous)
                                .stroke(strokeStyle(for: region), lineWidth: 1.5)
                        }
                        .contentShape(Rectangle())
                        .simultaneousGesture(selectionGesture(for: region))
                        .frame(width: max(rect.width, 28), height: max(rect.height, 28))
                        .position(x: rect.midX, y: rect.midY)
                        .accessibilityLabel(region.text)
                        .accessibilityHint("Copy or send recognized text")
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .scaleEffect(currentScale)
            .offset(currentOffset)
            .simultaneousGesture(magnificationGesture)
            .simultaneousGesture(dragGesture)
        }
    }

    private var magnificationGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                isMagnifying = true
                gestureScale = value
            }
            .onEnded { value in
                baseScale = min(max(baseScale * value, 1), 4)
                gestureScale = 1
                isMagnifying = false
                if baseScale == 1 {
                    baseOffset = .zero
                    gestureOffset = .zero
                }
            }
    }

    private var dragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                guard currentScale > 1 else { return }
                gestureOffset = value.translation
            }
            .onEnded { value in
                guard currentScale > 1 else {
                    baseOffset = .zero
                    gestureOffset = .zero
                    return
                }
                baseOffset = CGSize(
                    width: baseOffset.width + value.translation.width,
                    height: baseOffset.height + value.translation.height
                )
                gestureOffset = .zero
            }
    }

    private func selectionGesture(for region: RecognizedTextRegion) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onEnded { value in
                guard !isMagnifying else { return }
                guard abs(value.translation.width) <= 6, abs(value.translation.height) <= 6 else { return }
                onSelectRegion(region)
            }
    }

    private func fillStyle(for region: RecognizedTextRegion) -> Color {
        selectedRegion?.id == region.id ? .green.opacity(0.34) : .yellow.opacity(0.24)
    }

    private func strokeStyle(for region: RecognizedTextRegion) -> Color {
        selectedRegion?.id == region.id ? .green.opacity(0.92) : .yellow.opacity(0.9)
    }

    private func aspectFitRect(for imageSize: CGSize, in containerSize: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, containerSize.width > 0, containerSize.height > 0 else {
            return .zero
        }

        let scale = min(containerSize.width / imageSize.width, containerSize.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(
            x: (containerSize.width - size.width) / 2,
            y: (containerSize.height - size.height) / 2,
            width: size.width,
            height: size.height
        )
    }

    private func viewRect(for normalizedRect: CGRect, in imageRect: CGRect) -> CGRect {
        CGRect(
            x: imageRect.minX + normalizedRect.minX * imageRect.width,
            y: imageRect.minY + (1 - normalizedRect.maxY) * imageRect.height,
            width: normalizedRect.width * imageRect.width,
            height: normalizedRect.height * imageRect.height
        ).insetBy(dx: -3, dy: -3)
    }
}
