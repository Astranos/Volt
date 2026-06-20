import XCTest

final class VoltScreenshots: XCTestCase {
    @MainActor
    func testLaunchScreen() throws {
        continueAfterFailure = false

        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing", "--screenshots"]
        app.launchEnvironment["VOLT_SCREENSHOTS"] = "1"
        setupSnapshot(app)
        app.launch()

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        snapshot("01-launch")
    }
}
