import UIKit

/// Physical orientation of the device while capturing.
///
/// The app window stays locked to portrait, so — like the system Camera app — turning the phone
/// sideways rotates the control glyphs in place and re-tags the capture instead of relaying the UI.
enum CaptureOrientation: String, CaseIterable {
    case portrait
    case portraitUpsideDown
    case landscapeLeft
    case landscapeRight

    init?(deviceOrientation: UIDeviceOrientation) {
        switch deviceOrientation {
        case .portrait:
            self = .portrait
        case .portraitUpsideDown:
            self = .portraitUpsideDown
        case .landscapeLeft:
            self = .landscapeLeft
        case .landscapeRight:
            self = .landscapeRight
        default:
            return nil
        }
    }

    /// Clockwise degrees a portrait-locked control rotates by to stay upright in the hand.
    var controlRotationDegrees: Double {
        switch self {
        case .portrait:
            0
        case .portraitUpsideDown:
            180
        case .landscapeLeft:
            90
        case .landscapeRight:
            -90
        }
    }

    /// `AVCaptureConnection.videoRotationAngle` that keeps the saved photo level with the horizon.
    var videoRotationAngle: CGFloat {
        switch self {
        case .portrait:
            90
        case .portraitUpsideDown:
            270
        case .landscapeLeft:
            0
        case .landscapeRight:
            180
        }
    }
}
