import AVFoundation
import SwiftUI

struct CameraPreview: UIViewRepresentable {
    let previewLayer: AVCaptureVideoPreviewLayer

    func makeUIView(context: Context) -> PreviewLayerHostView {
        let view = PreviewLayerHostView()
        view.install(previewLayer)
        return view
    }

    func updateUIView(_ uiView: PreviewLayerHostView, context: Context) {
        uiView.install(previewLayer)
    }
}

final class PreviewLayerHostView: UIView {
    private weak var previewLayer: AVCaptureVideoPreviewLayer?

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
}
