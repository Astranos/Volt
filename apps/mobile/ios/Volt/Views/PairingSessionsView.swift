import SwiftUI

struct PairingSessionsView: View {
    @Environment(ScannerStore.self) private var store
    @State private var isPairingScannerPresented = false
    let showScanner: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    scanChromeQRButton
                }

                if store.pairedSessions.isEmpty {
                    ContentUnavailableView(
                        "No Paired Sessions",
                        systemImage: "link",
                        description: Text("Pair once from the Chrome QR code, then reconnect to that computer from here.")
                    )
                } else {
                    Section {
                        ForEach(store.pairedSessions) { session in
                            Button {
                                store.reconnect(to: session)
                                showScanner()
                            } label: {
                                PairedSessionRow(session: session)
                            }
                            .buttonStyle(.plain)
                            .swipeActions {
                                Button("Forget", systemImage: "trash", role: .destructive) {
                                    store.removePairedSession(session)
                                }
                            }
                        }
                    } header: {
                        Text("Previously Paired")
                    }
                }
            }
            .navigationTitle("Sessions")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if store.connectionStatus.isConnected {
                        Button("Unpair", systemImage: "link.badge.minus") {
                            store.unpair()
                        }
                    }
                }
            }
            .fullScreenCover(isPresented: $isPairingScannerPresented) {
                PairingScanSessionView(isPresented: $isPairingScannerPresented)
            }
        }
    }

    private var scanChromeQRButton: some View {
        Button {
            store.activeMode = .barcode
            isPairingScannerPresented = true
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 28, weight: .semibold))
                    .frame(width: 54, height: 54)
                    .background(.white.opacity(0.18), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text("Scan Chrome QR")
                        .font(.title3.weight(.bold))
                    Text("Open the camera to add a Chrome session.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.78))
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.headline.weight(.semibold))
            }
            .foregroundStyle(.white)
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(.green, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
        .listRowBackground(Color.clear)
    }
}

private struct PairingScanSessionView: View {
    @Environment(ScannerStore.self) private var store
    @Binding var isPresented: Bool

    var body: some View {
        ZStack {
            ScannerCameraLayer()
                .ignoresSafeArea()
        }
        .background(.black)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            PairingScanControls(
                statusText: store.statusText,
                targetHint: store.targetHint,
                onFinish: {
                    isPresented = false
                }
            )
        }
        .onAppear {
            store.activeMode = .barcode
            store.camera.lastBarcode = nil
            store.camera.lastBarcodeFormat = nil
            store.camera.start()
        }
        .onDisappear {
            store.camera.stop()
            if store.activeMode == .barcode {
                store.activeMode = .ocr
            }
        }
        .onChange(of: store.camera.lastBarcode) { _, _ in
            store.pairScannedBarcodeIfNeeded()
        }
        .onChange(of: store.connectionStatus) { _, newValue in
            if newValue.isConnected {
                isPresented = false
            }
        }
    }
}

private struct PairingScanControls: View {
    let statusText: String
    let targetHint: String
    let onFinish: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Label("Scan Chrome QR", systemImage: "qrcode.viewfinder")
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)

            Text(targetHint)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.76))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: .infinity)

            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(statusText)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                    Text("Center the Chrome pairing QR in the frame.")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.66))
                }

                Spacer(minLength: 12)

                Button("Finish", systemImage: "xmark") {
                    onFinish()
                }
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .frame(minHeight: 44)
                .padding(.horizontal, 14)
                .background(.black.opacity(0.54), in: Capsule())
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 22)
        .background {
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.78), .black.opacity(0.94)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        }
    }
}

private struct PairedSessionRow: View {
    let session: PairedScannerSession

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "desktopcomputer")
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                Text(session.displayName)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(session.lastConnectedAt, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let sessionId = session.sessionId {
                    Text(sessionId)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}
