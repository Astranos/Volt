import AVFoundation
import SwiftUI

struct CameraPreview: UIViewRepresentable {
    let previewLayer: AVCaptureVideoPreviewLayer
    var onTap: ((CGPoint, CGPoint) -> Void)?
    var onPinch: ((CGFloat, CameraZoomGesturePhase) -> Void)?

    func makeUIView(context: Context) -> PreviewLayerHostView {
        let view = PreviewLayerHostView()
        view.install(previewLayer)
        view.onTap = onTap
        view.onPinch = onPinch
        return view
    }

    func updateUIView(_ uiView: PreviewLayerHostView, context: Context) {
        uiView.install(previewLayer)
        uiView.onTap = onTap
        uiView.onPinch = onPinch
    }
}

final class PreviewLayerHostView: UIView {
    private weak var previewLayer: AVCaptureVideoPreviewLayer?
    var onTap: ((CGPoint, CGPoint) -> Void)?
    var onPinch: ((CGFloat, CameraZoomGesturePhase) -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        let tapRecognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        addGestureRecognizer(tapRecognizer)
        let pinchRecognizer = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        addGestureRecognizer(pinchRecognizer)
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    func install(_ layer: AVCaptureVideoPreviewLayer) {
        guard previewLayer !== layer else { return }
        layer.removeFromSuperlayer()
        self.layer.addSublayer(layer)
        previewLayer = layer
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer?.frame = bounds
    }

    @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
        guard let previewLayer else { return }
        let layerPoint = recognizer.location(in: self)
        let devicePoint = previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint)
        onTap?(devicePoint, layerPoint)
    }

    @objc private func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
        switch recognizer.state {
        case .began:
            onPinch?(recognizer.scale, .began)
        case .changed:
            onPinch?(recognizer.scale, .changed)
        case .ended, .cancelled, .failed:
            onPinch?(recognizer.scale, .ended)
        default:
            break
        }
    }
}
