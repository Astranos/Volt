import SwiftUI

struct ScannerView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isCaptureSessionPresented = false
    @State private var isPairingScannerPresented = false
    @State private var isSessionsPresented = false
    let showsCameraLayer: Bool

    init(showsCameraLayer: Bool = true) {
        self.showsCameraLayer = showsCameraLayer
    }

    private var captureResults: [ScanResult] {
        store.results.filter { $0.source == .capture }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScannerTabLayout.stackSpacing) {
                    ScannerSectionHeader(
                        title: "Capture",
                        onPair: {
                            isPairingScannerPresented = true
                        },
                        onSessions: {
                            isSessionsPresented = true
                        }
                    )

                    previousCaptures
                }
                .padding(ScannerTabLayout.contentPadding)
                .padding(.top, ScannerTabLayout.topPadding)
                .padding(.bottom, ScannerTabLayout.bottomAccessoryContentPadding)
            }
            .background(ScannerTabLayout.background)
            .navigationTitle("Capture")
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $isCaptureSessionPresented) {
                CaptureSessionView(isPresented: $isCaptureSessionPresented)
            }
            .fullScreenCover(isPresented: $isPairingScannerPresented) {
                PairingScanSessionView(isPresented: $isPairingScannerPresented)
            }
            .sheet(isPresented: $isSessionsPresented) {
                PairingSessionsView()
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .onAppear {
                store.activeMode = .ocr
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                CaptureStartAccessory(
                    isConnected: store.connectionStatus.isConnected,
                    statusText: captureStatusText,
                    targetHint: store.targetHint,
                    onStart: startCapture
                )
            }
        }
    }

    private var captureStatusText: String {
        if store.connectionStatus.isConnected {
            "Ready to capture into Chrome"
        } else {
            store.targetHint
        }
    }

    private func startCapture() {
        guard store.connectionStatus.isConnected else { return }
        store.clearOcrReview()
        store.activeMode = .ocr
        isCaptureSessionPresented = true
    }

    private var previousCaptures: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Previously Captured")
                    .font(.headline)
                Spacer()
                Text("\(captureResults.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if captureResults.isEmpty {
                ContentUnavailableView(
                    "No Captures Yet",
                    systemImage: "doc.text.magnifyingglass",
                    description: Text("Finished captures will show here after you leave the camera session.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 34)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                VStack(spacing: 10) {
                    ForEach(captureResults) { result in
                        CapturedResultRow(
                            result: result,
                            canResend: store.connectionStatus.isConnected,
                            onResend: {
                                Task { await store.resendResultToChrome(id: result.id) }
                            },
                            onDelete: {
                                store.removeResult(id: result.id)
                            }
                        )
                            .padding(14)
                            .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                }
            }
        }
    }

}

private struct CaptureStartAccessory: View {
    let isConnected: Bool
    let statusText: String
    let targetHint: String
    let onStart: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text(statusText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)

            Button(action: onStart) {
                Label("Start Capture", systemImage: "doc.viewfinder")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(
                        ScannerTabLayout.primaryActionBackground(isEnabled: isConnected),
                        in: RoundedRectangle(cornerRadius: ScannerTabLayout.primaryActionCornerRadius, style: .continuous)
                    )
                    .opacity(isConnected ? 1 : ScannerTabLayout.disabledPrimaryActionOpacity)
            }
            .buttonStyle(.plain)
            .disabled(!isConnected)
            .accessibilityHint(isConnected ? "Opens the camera capture session." : targetHint)
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
    }
}
