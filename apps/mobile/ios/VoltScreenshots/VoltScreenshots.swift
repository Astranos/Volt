import XCTest

final class VoltScreenshots: XCTestCase {
    /// Extracted text card: photo clip of the selected text, Edit/Raw/Flag row, and the flagged state.
    @MainActor
    func testExtractedTextCard() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing", "--screenshots"]
        app.launchEnvironment["VOLT_SCREENSHOTS"] = "1"
        app.launchEnvironment["VOLT_SCREENSHOT_SCENARIO"] = "captureReviewSend"
        app.launch()

        let openCamera = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Open Camera'")).firstMatch
        if openCamera.waitForExistence(timeout: 10) {
            openCamera.tap()
        }
        XCTAssertTrue(app.images["Photo of the selected text"].waitForExistence(timeout: 15))
        attachScreenshot(named: "extracted-text-card")

        let flag = app.buttons["Flag OCR result"]
        XCTAssertTrue(flag.waitForExistence(timeout: 5))
        flag.tap()
        XCTAssertTrue(app.buttons["OCR result flagged"].waitForExistence(timeout: 5))
        attachScreenshot(named: "extracted-text-card-flagged")

        // The longest secondary label ("Cleaned") must still fit beside Edit.
        let raw = app.buttons["Raw"]
        XCTAssertTrue(raw.waitForExistence(timeout: 5))
        let enabled = expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: raw)
        wait(for: [enabled], timeout: 15)
        raw.tap()
        XCTAssertTrue(app.buttons["Cleaned"].waitForExistence(timeout: 5))
        sleep(1)
        attachScreenshot(named: "extracted-text-card-raw")

        // Typing moves the card above the keyboard and turns Raw/Cleaned into Reset.
        let field = app.descendants(matching: .any)["extracted-text-field"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("X")
        XCTAssertTrue(app.buttons["Reset"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Hide keyboard"].exists)
        sleep(1)
        attachScreenshot(named: "extracted-text-card-typing")

        app.buttons["Hide keyboard"].tap()
        XCTAssertTrue(app.buttons["Reset"].waitForExistence(timeout: 5))
        sleep(1)
        attachScreenshot(named: "extracted-text-card-edited")
        app.terminate()
    }

    /// App Store builds keep the photo clip but never show Flag.
    @MainActor
    func testExtractedTextCardAppStore() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing", "--screenshots"]
        app.launchEnvironment["VOLT_SCREENSHOTS"] = "1"
        app.launchEnvironment["VOLT_SCREENSHOT_SCENARIO"] = "captureReviewSend"
        app.launchEnvironment["VOLT_SCREENSHOT_APP_STORE"] = "1"
        app.launch()

        let openCamera = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Open Camera'")).firstMatch
        if openCamera.waitForExistence(timeout: 10) {
            openCamera.tap()
        }
        XCTAssertTrue(app.images["Photo of the selected text"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Send"].exists)
        XCTAssertFalse(app.buttons["Flag OCR result"].exists)
        attachScreenshot(named: "extracted-text-card-app-store")
        app.terminate()
    }

    @MainActor
    private func attachScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testMockAppScreens() throws {
        continueAfterFailure = false

        capture(
            scenario: "sessions",
            name: "01-connected-sessions",
            waitFor: "Left Buyer"
        )
        capture(
            scenario: "captureTextPre",
            name: "02-capture-text-chip",
            waitForButton: "Serial FH7XC36BKDT0"
        )
        capture(
            scenario: "captureReview",
            name: "03-capture-text-extracted",
            waitFor: "Tap highlighted text"
        )
        capture(
            scenario: "captureReviewSend",
            name: "04-capture-send-popup",
            waitForButton: "Send"
        )
        capture(
            scenario: "captureBarcode",
            name: "05-capture-barcode-detected",
            waitForButton: "Capture barcode"
        )
        capture(
            scenario: "capturePhoto",
            name: "06-capture-photo-viewfinder",
            waitForButton: "Capture photo"
        )
        capture(
            scenario: "captureResults",
            name: "07-capture-results",
            waitFor: "711719573364"
        )
        capture(
            scenario: "dictation",
            name: "08-dictation",
            waitFor: "Description field"
        )
        capture(
            scenario: "upload",
            name: "09-upload-batches",
            waitFor: "Uploaded 5 photos"
        )
        captureFreeWorkspace()
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

    @MainActor
    private func captureFreeWorkspace() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing", "--screenshots"]
        app.launchEnvironment["VOLT_FREE_WORKSPACE_SCREENSHOT"] = "1"
        setupSnapshot(app)
        app.launch()

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        XCTAssertTrue(app.staticTexts["Scan and sync across devices at no cost during the pilot."].waitForExistence(timeout: 10))
        snapshot("10-volt-free-workspace")
        app.terminate()
    }
}
