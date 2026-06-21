import XCTest

final class VoltScreenshots: XCTestCase {
    @MainActor
    func testMockAppScreens() throws {
        continueAfterFailure = false

        capture(
            scenario: "sessions",
            name: "01-connected-sessions",
            waitFor: "Left Buyer"
        )
        capture(
            scenario: "captureReview",
            name: "02-capture-text-extracted",
            waitFor: "Tap highlighted text"
        )
        capture(
            scenario: "captureReviewSend",
            name: "03-capture-send-popup",
            waitForButton: "Send"
        )
        capture(
            scenario: "captureBarcode",
            name: "04-capture-barcode-detected",
            waitForButton: "Capture barcode"
        )
        capture(
            scenario: "capturePhoto",
            name: "05-capture-photo-viewfinder",
            waitForButton: "Capture photo"
        )
        capture(
            scenario: "captureResults",
            name: "06-capture-results",
            waitFor: "711719573364"
        )
        capture(
            scenario: "dictation",
            name: "07-dictation",
            waitFor: "Description field"
        )
        capture(
            scenario: "upload",
            name: "08-upload-batches",
            waitFor: "Uploaded 5 photos"
        )
    }

    @MainActor
    private func capture(scenario: String, name: String, waitFor text: String) {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing", "--screenshots"]
        app.launchEnvironment["VOLT_SCREENSHOTS"] = "1"
        app.launchEnvironment["VOLT_SCREENSHOT_SCENARIO"] = scenario
        setupSnapshot(app)
        app.launch()

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 10), "Expected screenshot text: \(text)")
        snapshot(name)
        app.terminate()
    }

    @MainActor
    private func capture(scenario: String, name: String, waitForButton buttonLabel: String) {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing", "--screenshots"]
        app.launchEnvironment["VOLT_SCREENSHOTS"] = "1"
        app.launchEnvironment["VOLT_SCREENSHOT_SCENARIO"] = scenario
        setupSnapshot(app)
        app.launch()

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        XCTAssertTrue(app.buttons[buttonLabel].waitForExistence(timeout: 10), "Expected screenshot button: \(buttonLabel)")
        snapshot(name)
        app.terminate()
    }
}
