import SwiftUI

struct CaptureModeTabView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isCaptureSessionPresented = false
    @State private var isTargetPickerPresented = false
    @State private var hasAppliedScreenshotLaunch = false

    let mode: CaptureMode

    private var matchingResults: [ScanResult] {
        store.results.filter { result in
            switch mode {
            case .ocr:
                result.kind == .text && result.source == .capture
            case .barcode:
                result.kind == .barcode && result.source == .capture
            case .photo:
                result.kind == .photo && result.source == .capture
            case .dictation:
                false
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    HStack(spacing: 12) {
                        Text(mode.tabTitle)
                            .font(.largeTitle.bold())

                        Spacer()

                        CloudTargetButton {
                            isTargetPickerPresented = true
                        }
                    }

                    CaptureModeLaunchCard(mode: mode, action: startCapture)

                    ComputerAvailabilityCard {
                        isTargetPickerPresented = true
                    }

                    CaptureModeActivityCard(mode: mode, count: matchingResults.count)
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle(mode.tabTitle)
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $isCaptureSessionPresented) {
                CaptureSessionView(
                    isPresented: $isCaptureSessionPresented,
                    mode: mode
                )
            }
            .sheet(isPresented: $isTargetPickerPresented) {
                CloudTargetPickerSheet()
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ScannerBottomActionAccessory(
                    title: mode.startActionTitle,
                    systemImage: mode.symbolName,
                    isEnabled: true,
                    statusText: captureStatusText,
                    disabledHint: store.targetHint,
                    action: startCapture
                )
            }
            .onAppear(perform: prepareMode)
        }
    }

    private var captureStatusText: String {
        if let computer = store.cloudWorkspace.selectedComputer {
            "New captures will insert into \(computer.label)."
        } else if let computer = store.cloudWorkspace.selectedTargetComputer {
            "\(computer.label) is offline. Captures will stay saved until you choose an online computer."
        } else {
            "Captures save to your Volt workspace without a computer connection."
        }
    }

    private func prepareMode() {
        store.selectedSection = mode.appSection
        store.activeMode = mode

        guard !hasAppliedScreenshotLaunch,
              ScreenshotScenario.current?.initialCaptureMode == mode,
              ScreenshotScenario.current?.opensCaptureSession == true
        else { return }

        hasAppliedScreenshotLaunch = true
        isCaptureSessionPresented = true
    }

    private func startCapture() {
        store.endResumedPhotoBatch()
        store.clearOcrReview()
        store.activeMode = mode
        isCaptureSessionPresented = true
    }
}
