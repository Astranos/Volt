import SwiftUI

struct CaptureGuideOverlay: View {
    let mode: CaptureMode
    var gridVisible = false

    var body: some View {
        GeometryReader { proxy in
            let targetZone = captureTargetZone(in: proxy)
            let guideSize = guideSize(for: mode, in: targetZone, screenWidth: proxy.size.width)

            ZStack {
                switch mode {
                case .barcode:
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(.green, lineWidth: 3)
                        .frame(width: guideSize.width, height: guideSize.height)
                        .overlay {
                            Rectangle()
                                .fill(.green.opacity(0.75))
                                .frame(height: 2)
                                .padding(.horizontal, 16)
                        }
                        .position(x: targetZone.midX, y: targetZone.midY)
                case .photo:
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(.white.opacity(0.72), lineWidth: 1.2)
                        .background(.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 24))
                        .frame(width: guideSize.width, height: guideSize.height)
                        .overlay {
                            if gridVisible {
                                SquareGrid()
                                    .clipShape(RoundedRectangle(cornerRadius: 24))
                                    .frame(width: guideSize.width, height: guideSize.height)
                            }
                        }
                        .position(x: targetZone.midX, y: targetZone.midY)
                case .ocr:
                    EmptyView()
                case .dictation:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .allowsHitTesting(false)
    }

    private func captureTargetZone(in proxy: GeometryProxy) -> CGRect {
        let topInset = proxy.safeAreaInsets.top
        let bottomInset = proxy.safeAreaInsets.bottom
        let top = topInset + 88
        let reservedControlsHeight: CGFloat = 318 + bottomInset
        let bottom = max(top + 220, proxy.size.height - reservedControlsHeight)

        return CGRect(
            x: 24,
            y: top,
            width: max(0, proxy.size.width - 48),
            height: max(220, bottom - top)
        )
    }

    private func guideSize(for mode: CaptureMode, in targetZone: CGRect, screenWidth: CGFloat) -> CGSize {
        switch mode {
        case .ocr:
            let width = min(targetZone.width, 360)
            let height = min(targetZone.height * 0.9, width * 1.28)
            return CGSize(width: width, height: max(260, height))
        case .barcode:
            let width = min(targetZone.width, 360)
            let height = min(max(targetZone.height * 0.34, 128), 176)
            return CGSize(width: width, height: height)
        case .photo:
            let side = min(targetZone.width, targetZone.height * 0.84, 360)
            return CGSize(width: side, height: side)
        case .dictation:
            return .zero
        }
    }
}

struct SquareGrid: View {
    var body: some View {
        GeometryReader { proxy in
            Path { path in
                let thirdWidth = proxy.size.width / 3
                let thirdHeight = proxy.size.height / 3
                for index in 1...2 {
                    let x = thirdWidth * CGFloat(index)
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: proxy.size.height))

                    let y = thirdHeight * CGFloat(index)
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: proxy.size.width, y: y))
                }
            }
            .stroke(.white.opacity(0.36), lineWidth: 0.8)
        }
    }
}
