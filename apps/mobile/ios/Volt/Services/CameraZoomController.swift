@preconcurrency import AVFoundation
import CoreGraphics
import Foundation

struct CameraZoomState: Sendable {
    let rawFactor: CGFloat
    let displayFactor: CGFloat
    let rawMinFactor: CGFloat
    let rawMaxFactor: CGFloat
    let displayMinFactor: CGFloat
    let displayMaxFactor: CGFloat
    let displayLabel: String
}

enum CameraZoomController {
    private static let maxDisplayZoomFactor: CGFloat = 6
    private static let zoomRampRate: Float = 12

    static func clampedRawZoomFactor(_ factor: CGFloat, for device: AVCaptureDevice) -> CGFloat {
        let displayMultiplier = displayZoomFactorMultiplier(for: device)
        let displayLimitedMaxZoomFactor = maxDisplayZoomFactor / displayMultiplier
        let maxZoomFactor = min(device.maxAvailableVideoZoomFactor, displayLimitedMaxZoomFactor)
        return max(device.minAvailableVideoZoomFactor, min(maxZoomFactor, factor))
    }

    static func rawZoomFactor(forDisplayZoomFactor factor: CGFloat, on device: AVCaptureDevice) -> CGFloat {
        clampedRawZoomFactor(factor / displayZoomFactorMultiplier(for: device), for: device)
    }

    static func rawZoomFactor(
        forDisplayZoomDelta delta: CGFloat,
        currentDisplayZoomFactor: CGFloat,
        on device: AVCaptureDevice
    ) -> CGFloat {
        rawZoomFactor(forDisplayZoomFactor: currentDisplayZoomFactor + delta, on: device)
    }

    static func rawZoomFactor(
        forDisplayZoomScale scale: CGFloat,
        currentDisplayZoomFactor: CGFloat,
        on device: AVCaptureDevice
    ) -> CGFloat {
        rawZoomFactor(forDisplayZoomFactor: currentDisplayZoomFactor * scale, on: device)
    }

    static func rawZoomFactorForDisplayOne(on device: AVCaptureDevice) -> CGFloat {
        rawZoomFactor(forDisplayZoomFactor: 1, on: device)
    }

    static func displayZoomFactorMultiplier(for device: AVCaptureDevice) -> CGFloat {
        max(device.displayVideoZoomFactorMultiplier, .leastNonzeroMagnitude)
    }

    static func state(for device: AVCaptureDevice, rawZoomFactor: CGFloat) -> CameraZoomState {
        let clampedFactor = clampedRawZoomFactor(rawZoomFactor, for: device)
        let displayMultiplier = displayZoomFactorMultiplier(for: device)
        let displayFactor = clampedFactor * displayMultiplier
        let rawMinFactor = device.minAvailableVideoZoomFactor
        let rawMaxFactor = clampedRawZoomFactor(device.maxAvailableVideoZoomFactor, for: device)
        let roundedDisplayFactor = (Double(displayFactor) * 10).rounded() / 10
        let displayLabel = "\(roundedDisplayFactor.formatted(.number.precision(.fractionLength(0...1))))x"

        return CameraZoomState(
            rawFactor: clampedFactor,
            displayFactor: displayFactor,
            rawMinFactor: rawMinFactor,
            rawMaxFactor: rawMaxFactor,
            displayMinFactor: rawMinFactor * displayMultiplier,
            displayMaxFactor: rawMaxFactor * displayMultiplier,
            displayLabel: displayLabel
        )
    }

    static func setRawZoomFactor(
        _ rawZoomFactor: CGFloat,
        on device: AVCaptureDevice,
        ramping: Bool = false
    ) throws -> CameraZoomState {
        let clampedFactor = clampedRawZoomFactor(rawZoomFactor, for: device)
        try device.lockForConfiguration()
        if ramping {
            device.cancelVideoZoomRamp()
            device.ramp(toVideoZoomFactor: clampedFactor, withRate: zoomRampRate)
        } else {
            device.videoZoomFactor = clampedFactor
        }
        device.unlockForConfiguration()
        return state(for: device, rawZoomFactor: clampedFactor)
    }

    static func resetToDisplayOne(on device: AVCaptureDevice) throws -> CameraZoomState {
        try setRawZoomFactor(rawZoomFactorForDisplayOne(on: device), on: device)
    }
}
