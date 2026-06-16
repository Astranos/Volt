import AVFoundation
import SwiftUI

struct CameraPreview: UIViewRepresentable {
    let previewLayer: AVCaptureVideoPreviewLayer
    var onTap: ((CGPoint) -> Void)?

    func makeUIView(context: Context) -> PreviewLayerHostView {
        let view = PreviewLayerHostView()
        view.install(previewLayer)
        view.onTap = onTap
        return view
    }

    func updateUIView(_ uiView: PreviewLayerHostView, context: Context) {
        uiView.install(previewLayer)
        uiView.onTap = onTap
    }
}

final class PreviewLayerHostView: UIView {
    private weak var previewLayer: AVCaptureVideoPreviewLayer?
    var onTap: ((CGPoint) -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        let tapRecognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        addGestureRecognizer(tapRecognizer)
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
        onTap?(previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint))
    }
}
