import Foundation

struct ScannerPeerTarget: Equatable {
    var chromeSessionId: String?
    var sessionLabel: String?
    var tabTitle: String?
    var tabURL: String?
    var cursorLabel: String?
    var browser: String?

    var isWebPageSession: Bool {
        browser == "Browser"
    }

    var displayText: String {
        if let sessionLabel, !sessionLabel.isEmpty {
            sessionLabel
        } else if let cursorLabel, !cursorLabel.isEmpty {
            cursorLabel
        } else if let tabTitle, !tabTitle.isEmpty {
            tabTitle
        } else {
            browser ?? "Chrome"
        }
    }
}
