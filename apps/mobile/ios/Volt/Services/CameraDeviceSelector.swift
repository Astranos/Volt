@preconcurrency import AVFoundation
import CoreGraphics

enum CameraDeviceSelector {
    static let centerFocusPoint = CGPoint(x: 0.5, y: 0.5)

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

    static func configureNativeVirtualDeviceSwitching(on device: AVCaptureDevice) {
        guard #available(iOS 15.0, *),
              device.isVirtualDevice,
              device.primaryConstituentDeviceSwitchingBehavior != .unsupported
        else { return }

        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            device.setPrimaryConstituentDeviceSwitchingBehavior(
                .auto,
                restrictedSwitchingBehaviorConditions: []
            )
        } catch {
            return
        }
    }

    @discardableResult
    static func applySmoothTapFocus(on device: AVCaptureDevice, point: CGPoint) -> Bool {
        var didApplyFocus = false
        if device.isSmoothAutoFocusSupported {
            device.isSmoothAutoFocusEnabled = true
        }
        if device.isAutoFocusRangeRestrictionSupported {
            device.autoFocusRangeRestriction = .none
        }
        if device.isFocusPointOfInterestSupported {
            device.focusPointOfInterest = point
            if device.isFocusModeSupported(.autoFocus) {
                device.focusMode = .autoFocus
                didApplyFocus = true
            } else if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
                didApplyFocus = true
            }
        }
        if device.isExposurePointOfInterestSupported {
            device.exposurePointOfInterest = point
            if device.isExposureModeSupported(.autoExpose) {
                device.exposureMode = .autoExpose
            } else if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
        }
        device.isSubjectAreaChangeMonitoringEnabled = true
        return didApplyFocus
    }

    @discardableResult
    static func applyBarcodeFocus(on device: AVCaptureDevice, point: CGPoint) -> Bool {
        var didApplyFocus = false
        if device.isSmoothAutoFocusSupported {
            device.isSmoothAutoFocusEnabled = false
        }
        if device.isAutoFocusRangeRestrictionSupported {
            device.autoFocusRangeRestriction = .near
        }
        if device.isFocusPointOfInterestSupported {
            device.focusPointOfInterest = point
        }
        if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
            didApplyFocus = device.isFocusPointOfInterestSupported
        } else if device.isFocusModeSupported(.autoFocus) {
            device.focusMode = .autoFocus
            didApplyFocus = device.isFocusPointOfInterestSupported
        }
        if device.isExposurePointOfInterestSupported {
            device.exposurePointOfInterest = point
        }
        if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
        } else if device.isExposureModeSupported(.autoExpose) {
            device.exposureMode = .autoExpose
        }
        device.isSubjectAreaChangeMonitoringEnabled = false
        return didApplyFocus
    }

    static func applyDefaultContinuousFocus(on device: AVCaptureDevice) {
        if device.isAutoFocusRangeRestrictionSupported {
            device.autoFocusRangeRestriction = .none
        }
        if device.isFocusPointOfInterestSupported {
            device.focusPointOfInterest = centerFocusPoint
        }
        if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
        }
        if device.isExposurePointOfInterestSupported {
            device.exposurePointOfInterest = centerFocusPoint
        }
        if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
        }
        device.isSubjectAreaChangeMonitoringEnabled = true
    }
}
