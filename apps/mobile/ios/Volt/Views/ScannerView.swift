import SwiftUI

struct ScannerView: View {
    @Environment(ScannerStore.self) private var store
    let mode: CaptureMode

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                cameraLayer
                    .ignoresSafeArea()

                VStack(spacing: 14) {
                    statusPanel
                    captureButton
                }
                .padding()
                .background(.thinMaterial)
            }
            .navigationTitle(store.activeMode.title)
            .navigationBarTitleDisplayMode(.inline)
            .task {
                store.activeMode = mode
                await store.camera.requestAccess()
                store.camera.start()
            }
            .onAppear {
                store.activeMode = mode
            }
            .onChange(of: store.camera.lastBarcode) {
                store.saveBarcodeIfNeeded()
            }
        }
    }

    private var cameraLayer: some View {
        Group {
            if store.camera.authorizationStatus == .authorized {
                CameraPreview(session: store.camera.session)
                    .overlay(alignment: .center) {
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(.green, lineWidth: 3)
                            .frame(maxWidth: 320, maxHeight: 180)
                            .padding(32)
                    }
            } else {
                ContentUnavailableView(
                    "Camera Access Required",
                    systemImage: "camera",
                    description: Text("Enable camera access to scan barcodes, capture photos, and run text recognition.")
                )
            }
        }
    }

    private var statusPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(store.statusText)
                .font(.headline)
            Text(store.targetHint)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let barcode = store.camera.lastBarcode {
                Text(barcode)
                    .font(.footnote.monospaced())
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var captureButton: some View {
        Button {
            Task { await store.capturePhoto() }
        } label: {
            Label(store.activeMode == .ocr ? "Capture Text" : "Capture", systemImage: "camera.circle.fill")
                .font(.headline)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
    }
}
