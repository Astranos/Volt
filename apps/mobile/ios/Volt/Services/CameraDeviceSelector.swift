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

    static func restrictFocusDrivenVirtualDeviceSwitching(on device: AVCaptureDevice) {
        guard #available(iOS 15.0, *),
              device.isVirtualDevice,
              device.primaryConstituentDeviceSwitchingBehavior != .unsupported
        else { return }

        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            device.setPrimaryConstituentDeviceSwitchingBehavior(
                .restricted,
                restrictedSwitchingBehaviorConditions: [.videoZoomChanged]
            )
        } catch {
            return
        }
    }
}
