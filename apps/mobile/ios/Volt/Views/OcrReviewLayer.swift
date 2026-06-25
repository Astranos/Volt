import SwiftUI
import UIKit

struct OcrReviewLayer: View {
    let image: UIImage
    let regions: [RecognizedTextRegion]
    let selectedRegion: RecognizedTextRegion?
    let imageContentMode: ContentMode
    let fillFocusX: CGFloat
    let onSelectRegion: (RecognizedTextRegion) -> Void
    @State private var baseScale: CGFloat = 1
    @State private var gestureScale: CGFloat = 1
    @State private var baseOffset: CGSize = .zero
    @State private var gestureOffset: CGSize = .zero
    @State private var isMagnifying = false
    @State private var isPanning = false
    @State private var lastPanEndedAt = Date.distantPast

    private let minimumTapTargetSize: CGFloat = 28
    private let panSelectionSuppression: TimeInterval = 0.24

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
            let imageRect = imageRect(for: image.size, in: proxy.size)

            ZStack {
                Color.black

                Image(uiImage: image)
                    .resizable()
                    .frame(width: imageRect.width, height: imageRect.height)
                    .position(x: imageRect.midX, y: imageRect.midY)

                ForEach(regions) { region in
                    let points = viewPoints(for: region.quadrilateral, in: imageRect)
                    let bounds = boundingRect(for: points)
                    let tapTargetSize = tapTargetSize(for: bounds)
                    let shape = OcrRegionShape(points: points)

                    shape
                        .fill(fillStyle(for: region))
                        .overlay {
                            shape.stroke(strokeStyle(for: region), lineWidth: 1.5 / currentScale)
                        }
                        .allowsHitTesting(false)
                        .frame(width: proxy.size.width, height: proxy.size.height)

                    Rectangle()
                        .fill(.clear)
                        .contentShape(Rectangle())
                        .simultaneousGesture(selectionGesture(for: region))
                        .contextMenu {
                            Button("Copy", systemImage: "doc.on.doc") {
                                UIPasteboard.general.string = region.text
                            }
                            Button("Select", systemImage: "text.viewfinder") {
                                onSelectRegion(region)
                            }
                        }
                        .frame(width: tapTargetSize.width, height: tapTargetSize.height)
                        .position(x: bounds.midX, y: bounds.midY)
                        .accessibilityLabel(region.text)
                        .accessibilityHint("Copy or send recognized text")
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
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
                if abs(value.translation.width) > 8 || abs(value.translation.height) > 8 {
                    isPanning = true
                }
                gestureOffset = value.translation
            }
            .onEnded { value in
                guard currentScale > 1 else {
                    baseOffset = .zero
                    gestureOffset = .zero
                    return
                }
                if isPanning || abs(value.translation.width) > 8 || abs(value.translation.height) > 8 {
                    lastPanEndedAt = Date()
                }
                baseOffset = CGSize(
                    width: baseOffset.width + value.translation.width,
                    height: baseOffset.height + value.translation.height
                )
                gestureOffset = .zero
                isPanning = false
            }
    }

    private func selectionGesture(for region: RecognizedTextRegion) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onEnded { value in
                guard !isMagnifying else { return }
                guard !isPanning else { return }
                guard Date().timeIntervalSince(lastPanEndedAt) > panSelectionSuppression else { return }
                guard abs(value.translation.width) <= 6, abs(value.translation.height) <= 6 else { return }
                onSelectRegion(region)
            }
    }

    private func fillStyle(for region: RecognizedTextRegion) -> Color {
        if selectedRegion?.id == region.id {
            return .green.opacity(0.34)
        }
        return region.isDeviceIdentifier ? .green.opacity(0.24) : .yellow.opacity(0.24)
    }

    private func strokeStyle(for region: RecognizedTextRegion) -> Color {
        if selectedRegion?.id == region.id {
            return .green.opacity(0.92)
        }
        return region.isDeviceIdentifier ? .green.opacity(0.9) : .yellow.opacity(0.9)
    }

    private func aspectFitRect(for imageSize: CGSize, in containerSize: CGSize) -> CGRect {
        aspectRect(for: imageSize, in: containerSize, scale: min)
    }

    private func aspectFillRect(for imageSize: CGSize, in containerSize: CGSize) -> CGRect {
        let centeredRect = aspectRect(for: imageSize, in: containerSize, scale: max)
        guard centeredRect.width > containerSize.width else {
            return centeredRect
        }

        let focusedX = (containerSize.width / 2) - (centeredRect.width * fillFocusX)
        return CGRect(
            x: min(max(focusedX, containerSize.width - centeredRect.width), 0),
            y: centeredRect.minY,
            width: centeredRect.width,
            height: centeredRect.height
        )
    }

    private func imageRect(for imageSize: CGSize, in containerSize: CGSize) -> CGRect {
        switch imageContentMode {
        case .fill:
            aspectFillRect(for: imageSize, in: containerSize)
        case .fit:
            aspectFitRect(for: imageSize, in: containerSize)
        @unknown default:
            aspectFitRect(for: imageSize, in: containerSize)
        }
    }

    private func aspectRect(
        for imageSize: CGSize,
        in containerSize: CGSize,
        scale scaleFunction: (CGFloat, CGFloat) -> CGFloat
    ) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, containerSize.width > 0, containerSize.height > 0 else {
            return .zero
        }

        let scale = scaleFunction(containerSize.width / imageSize.width, containerSize.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(
            x: (containerSize.width - size.width) / 2,
            y: (containerSize.height - size.height) / 2,
            width: size.width,
            height: size.height
        )
    }

    private func viewPoints(for quadrilateral: TextQuadrilateral, in imageRect: CGRect) -> [CGPoint] {
        quadrilateral.points.map { point in
            CGPoint(
                x: imageRect.minX + point.x * imageRect.width,
                y: imageRect.minY + (1 - point.y) * imageRect.height
            )
        }
    }

    private func boundingRect(for points: [CGPoint]) -> CGRect {
        guard let first = points.first else { return .zero }

        var minX = first.x
        var maxX = first.x
        var minY = first.y
        var maxY = first.y

        for point in points.dropFirst() {
            minX = min(minX, point.x)
            maxX = max(maxX, point.x)
            minY = min(minY, point.y)
            maxY = max(maxY, point.y)
        }

        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
            .insetBy(dx: -targetPadding, dy: -targetPadding)
    }

    private var targetPadding: CGFloat {
        3 / currentScale
    }

    private func tapTargetSize(for rect: CGRect) -> CGSize {
        CGSize(
            width: max(rect.width, minimumTapTargetSize / currentScale),
            height: max(rect.height, minimumTapTargetSize / currentScale)
        )
    }
}

private struct OcrRegionShape: Shape {
    let points: [CGPoint]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard let first = points.first else { return path }

        path.move(to: first)
        for point in points.dropFirst() {
            path.addLine(to: point)
        }
        path.closeSubpath()
        return path
    }
}
