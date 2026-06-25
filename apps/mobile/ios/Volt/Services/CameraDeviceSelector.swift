@preconcurrency import AVFoundation

enum CameraDeviceSelector {
    static func bestBackCamera() -> AVCaptureDevice? {
        let preferredDeviceTypes: [AVCaptureDevice.DeviceType] = [
            .builtInTripleCamera,
            .builtInDualWideCamera,
            .builtInDualCamera,
            .builtInWideAngleCamera,
        ]

        return preferredDeviceTypes.lazy.compactMap {
            AVCaptureDevice.default($0, for: .video, position: .back)
        }.first
    }
}
