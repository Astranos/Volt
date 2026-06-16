import Foundation

struct ScannerPeerTarget: Equatable {
    var chromeSessionId: String?
    var tabTitle: String?
    var tabURL: String?
    var cursorLabel: String?
    var browser: String?

    var displayText: String {
        if let cursorLabel, !cursorLabel.isEmpty {
            cursorLabel
        } else if let tabTitle, !tabTitle.isEmpty {
            tabTitle
        } else {
            "Chrome"
        }
    }
}
