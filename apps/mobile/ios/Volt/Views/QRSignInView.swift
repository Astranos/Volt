@preconcurrency import AVFoundation
import ClerkKit
import SwiftUI
import UIKit

/// Sheet for signing in with a QR code from Volt in Chrome.
struct QRSignInView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(QRSignInStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @FocusState private var emailFocused: Bool
    @State private var cameraDenied = false

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            Group {
                switch store.phase {
                case .enteringEmail, .requesting:
                    emailStep(email: $store.email)
                case .waitingForScan(let expiresAt):
                    scanStep(expiresAt: expiresAt)
                case .signingIn:
                    ProgressView("Signing in…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityIdentifier("volt-qr-sign-in-progress")
                }
            }
            .navigationTitle("Sign in with Chrome")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                }
            }
        }
        .accessibilityIdentifier("volt-qr-sign-in")
    }

    private func emailStep(email: Binding<String>) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Donut in Chrome will show a QR code on your computer. Scan it here to sign in, no password needed.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Email")
                        .font(.subheadline.weight(.semibold))
                    TextField("you@example.com", text: email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.send)
                        .focused($emailFocused)
                        .onSubmit(send)
                        .padding(12)
                        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))
                        .accessibilityIdentifier("volt-qr-sign-in-email")
                }

                if let errorMessage = store.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.circle")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("volt-qr-sign-in-error")
                }

                Button(action: send) {
                    Group {
                        if store.phase == .requesting {
                            ProgressView()
                        } else {
                            Text("Send to Chrome")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .font(.headline)
                .controlSize(.large)
                .buttonStyle(.glassProminent)
                .tint(VoltBrand.green)
                .disabled(!store.canSubmit)
                .accessibilityIdentifier("volt-qr-sign-in-send")

                Text("Chrome needs to be open on a computer where you're signed in to Donut.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(24)
        }
        .onAppear {
            if store.email.isEmpty { emailFocused = true }
        }
    }

    private func scanStep(expiresAt: Date) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                Text("On your computer, click the Donut notification in Chrome, then scan the QR code it shows.")
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                if cameraDenied {
                    cameraDeniedNotice
                } else {
                    SignInQRScannerView(
                        onCode: { value in
                            Task { await store.handleScannedValue(value, clerk: clerk) }
                        },
                        onDenied: { cameraDenied = true }
                    )
                    .aspectRatio(1, contentMode: .fit)
                    .frame(maxWidth: 320)
                    .clipShape(.rect(cornerRadius: 24))
                    .overlay {
                        RoundedRectangle(cornerRadius: 24)
                            .strokeBorder(VoltBrand.green.opacity(0.6), lineWidth: 2)
                    }
                    .accessibilityLabel("Camera for scanning the sign-in QR code")
                }

                if let scanHint = store.scanHint {
                    Label(scanHint, systemImage: "info.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("volt-qr-sign-in-hint")
                }

                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let remaining = max(0, Int(expiresAt.timeIntervalSince(context.date).rounded(.up)))
                    Text(remaining > 0
                         ? "Expires in \(remaining / 60):\(String(format: "%02d", remaining % 60))"
                         : "This request expired.")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                Text("Sent to \(store.email)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button("Start over") { store.startOver() }
                    .accessibilityIdentifier("volt-qr-sign-in-start-over")
            }
            .padding(24)
        }
    }

    private var cameraDeniedNotice: some View {
        VStack(spacing: 12) {
            Label("Camera access is off", systemImage: "camera.badge.ellipsis")
                .font(.headline)
            Text("Allow camera access in Settings to scan the code, or close this and sign in with your email instead.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            .buttonStyle(.bordered)
        }
        .padding(20)
        .frame(maxWidth: 320)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 24))
        .accessibilityIdentifier("volt-qr-sign-in-camera-denied")
    }

    private func send() {
        Task { await store.requestSignIn() }
    }
}

/// Camera preview that reports every distinct QR value it sees, so a wrong
/// code can be followed by the right one without reopening the sheet.
private struct SignInQRScannerView: UIViewRepresentable {
    let onCode: (String) -> Void
    let onDenied: () -> Void

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.backgroundColor = .black
        view.previewLayer.videoGravity = .resizeAspectFill
        context.coordinator.start(in: view)
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        context.coordinator.onCode = onCode
        context.coordinator.onDenied = onDenied
    }

    static func dismantleUIView(_ uiView: PreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode, onDenied: onDenied)
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
        var onCode: (String) -> Void
        var onDenied: () -> Void
        private let session = AVCaptureSession()
        private var lastValue: String?

        init(onCode: @escaping (String) -> Void, onDenied: @escaping () -> Void) {
            self.onCode = onCode
            self.onDenied = onDenied
        }

        func start(in view: PreviewView) {
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                Task { @MainActor in self.configure(view) }
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { [weak self, weak view] granted in
                    guard let self else { return }
                    guard granted else {
                        Task { @MainActor in self.onDenied() }
                        return
                    }
                    guard let view else { return }
                    Task { @MainActor in self.configure(view) }
                }
            default:
                Task { @MainActor in self.onDenied() }
            }
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard let value = metadataObjects
                .compactMap({ $0 as? AVMetadataMachineReadableCodeObject })
                .first(where: { $0.type == .qr })?
                .stringValue,
                value != lastValue else { return }
            lastValue = value
            onCode(value)
        }

        func stop() {
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                if session.isRunning { session.stopRunning() }
            }
        }

        @MainActor
        private func configure(_ view: PreviewView) {
            guard !session.isRunning,
                  let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else { return }
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }
            session.beginConfiguration()
            session.addInput(input)
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = output.availableMetadataObjectTypes.contains(.qr) ? [.qr] : []
            session.commitConfiguration()
            view.previewLayer.session = session
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                session.startRunning()
            }
        }
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
