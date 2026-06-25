@preconcurrency import AVFoundation
import CoreGraphics

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
            if !device.supportedFallbackPrimaryConstituentDevices.isEmpty {
                device.fallbackPrimaryConstituentDevices = []
            }
            device.setPrimaryConstituentDeviceSwitchingBehavior(
                .restricted,
                restrictedSwitchingBehaviorConditions: [.videoZoomChanged]
            )
        } catch {
            return
        }
    }

    static func applySmoothTapFocus(on device: AVCaptureDevice, point: CGPoint) {
        if device.isSmoothAutoFocusSupported {
            device.isSmoothAutoFocusEnabled = true
        }
        if device.isFocusPointOfInterestSupported {
            device.focusPointOfInterest = point
            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            } else if device.isFocusModeSupported(.autoFocus) {
                device.focusMode = .autoFocus
            }
        }
        if device.isExposurePointOfInterestSupported {
            device.exposurePointOfInterest = point
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            } else if device.isExposureModeSupported(.autoExpose) {
                device.exposureMode = .autoExpose
            }
        }
        device.isSubjectAreaChangeMonitoringEnabled = true
    }
}
