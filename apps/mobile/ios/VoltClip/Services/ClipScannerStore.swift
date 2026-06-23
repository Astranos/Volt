import Foundation
import Observation
import SwiftUI
import UIKit
import WebKit

@MainActor
@Observable
final class ClipScannerStore {
    enum ClipTab: String, CaseIterable, Identifiable {
        case capture
        case dictate
        case upload

        var id: String { rawValue }

        var title: String {
            switch self {
            case .capture: "Capture"
            case .dictate: "Dictate"
            case .upload: "Upload"
            }
        }

        var systemImage: String {
            switch self {
            case .capture: "camera.viewfinder"
            case .dictate: "mic"
            case .upload: "square.and.arrow.up"
            }
        }
    }

    struct ClipPhoto: Identifiable, Equatable {
        let id = UUID()
        let image: UIImage
        var status: String
    }

    struct ClipCapture: Identifiable, Equatable {
        let id = UUID()
        let mode: CaptureMode
        let value: String
        let format: String
        let capturedAt: Date
        var status: String
    }

    var selectedTab: ClipTab = .capture
    var activeCaptureMode: CaptureMode = .photo
    var pairingURLText = ""
    var statusText = "Open Volt in Chrome and scan the pairing code."
    var targetHint = "Not connected"
    var transcript = ""
    var isPairing = false
    var isConnected = false
    var isDictating = false
    var isRecognizingText = false
    var photos: [ClipPhoto] = []
    var captures: [ClipCapture] = []
    var ocrReviewImage: UIImage?
    var ocrTextRegions: [RecognizedTextRegion] = []
    var ocrReviewText = ""
    var errorMessage: String?

    private let contributorId = ScannerProtocol.makeContributorId()
    @ObservationIgnored private let ocrService = ClipOCRService()
    @ObservationIgnored private let transport = WebKitWebRTCTransport()
    private var pairingSession: PairingSession?

    var bridgeWebView: WKWebView {
        transport.embeddedWebView
    }

    init() {
        transport.onStatus = { [weak self] status in
            self?.statusText = status
        }
        transport.onConnected = { [weak self] sessionReady in
            self?.isConnected = true
            self?.isPairing = false
            self?.targetHint = sessionReady.cursorTarget?.label ?? "Ready for Chrome"
            self?.statusText = "Connected to Chrome"
        }
        transport.onTranscript = { [weak self] text, final in
            self?.transcript = text
            if final {
                self?.statusText = "Dictation recognized"
            }
        }
        transport.onClosed = { [weak self] in
            self?.isConnected = false
            self?.isDictating = false
            self?.targetHint = "Disconnected"
            self?.statusText = "Connection closed"
        }
        transport.onError = { [weak self] message in
            self?.isPairing = false
            self?.isDictating = false
            self?.errorMessage = message
            self?.statusText = self?.isConnected == true ? "Dictation failed" : "Connection failed"
        }
    }

    func handleIncomingURL(_ url: URL) {
        let (session, mode) = PairingURLParser.parse(url)
        if let mode {
            selectMode(mode)
        }
        guard let session else { return }
        pairingSession = session
        pairingURLText = url.absoluteString
        Task { await pair(session) }
    }

    func pairFromText() {
        guard let url = PairingURLParser.pairingURL(in: pairingURLText) ?? URL(string: pairingURLText) else {
            errorMessage = "Paste a Volt pairing URL from Chrome."
            return
        }
        handleIncomingURL(url)
    }

    func pairFromScannedValue(_ value: String) -> Bool {
        guard !isPairing, !isConnected else { return true }
        return handlePairingValue(value, invalidMessage: "That QR is not a Volt pairing QR.")
    }

    func pair(_ session: PairingSession? = nil) async {
        let nextSession = session ?? pairingSession
        guard let nextSession else {
            errorMessage = "Open a pairing link first."
            return
        }

        isPairing = true
        errorMessage = nil
        statusText = "Pairing with Chrome"
        do {
            try await transport.pair(with: nextSession, contributorId: contributorId)
        } catch {
            isPairing = false
            errorMessage = error.localizedDescription
            statusText = "Pairing failed"
        }
    }

    func startDictation() {
        guard isConnected else {
            errorMessage = "Connect to Chrome first."
            statusText = "Connect to Chrome first"
            return
        }
        errorMessage = nil
        statusText = "Starting dictation"
        isDictating = true
        transcript = ""
        transport.startDictation()
    }

    func stopDictation() {
        isDictating = false
        transport.stopDictation()
    }

    func addCapturedImage(_ image: UIImage) {
        photos.insert(ClipPhoto(image: image, status: "Ready to send"), at: 0)
        selectedTab = .upload
    }

    func addImportedImage(_ image: UIImage) {
        photos.insert(ClipPhoto(image: image, status: "Ready to send"), at: 0)
    }

    func sendPhoto(_ photo: ClipPhoto) async {
        guard isConnected else {
            errorMessage = "Connect to Chrome first."
            return
        }
        updatePhoto(photo.id, status: "Sending")
        do {
            try await transport.sendPhoto(photo.image, contributorId: contributorId)
            updatePhoto(photo.id, status: "Sent")
        } catch {
            updatePhoto(photo.id, status: "Failed")
            errorMessage = error.localizedDescription
        }
    }

    func handleBarcodeScan(_ scan: ClipBarcodeScan) {
        if scan.isQRCode, handlePairingValue(scan.value, invalidMessage: nil) {
            return
        }
        guard activeCaptureMode == .barcode else { return }
        let normalized = normalizedBarcodeScan(value: scan.value, format: scan.format)
        sendCapture(
            mode: .barcode,
            value: normalized.value,
            format: normalized.format,
            capturedAt: scan.capturedAt
        )
    }

    func recognizeText(in image: UIImage) async {
        guard !isRecognizingText else { return }
        isRecognizingText = true
        errorMessage = nil
        statusText = "Recognizing text"
        defer { isRecognizingText = false }

        do {
            let result = try await ocrService.recognizeText(in: image)
            guard !result.isEmpty else {
                ocrReviewImage = image
                ocrTextRegions = []
                ocrReviewText = ""
                statusText = "No text found"
                return
            }
            if handlePairingValue(result.text, invalidMessage: nil) {
                clearOcrReview()
                return
            }
            ocrReviewImage = image
            ocrTextRegions = result.regions
            ocrReviewText = result.text
            statusText = "Tap highlighted text"
        } catch {
            errorMessage = error.localizedDescription
            statusText = "Text recognition failed"
        }
    }

    func clearOcrReview() {
        ocrReviewImage = nil
        ocrTextRegions = []
        ocrReviewText = ""
    }

    func sendRecognizedText(_ text: String, format: String = "vision-text") {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if handlePairingValue(trimmed, invalidMessage: nil) {
            return
        }
        sendCapture(mode: .ocr, value: trimmed, format: format, capturedAt: .now)
    }

    func selectMode(_ mode: CaptureMode) {
        activeCaptureMode = mode
        selectedTab = tab(for: mode)
    }

    func disconnect() {
        transport.close()
        isConnected = false
        isDictating = false
    }

    private func updatePhoto(_ id: UUID, status: String) {
        guard let index = photos.firstIndex(where: { $0.id == id }) else { return }
        photos[index].status = status
    }

    private func sendCapture(
        mode: CaptureMode,
        value: String,
        format: String,
        capturedAt: Date
    ) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let initialStatus = isConnected ? "Sending" : "Saved until connected"
        let capture = ClipCapture(
            mode: mode,
            value: trimmed,
            format: format,
            capturedAt: capturedAt,
            status: initialStatus
        )
        captures.insert(capture, at: 0)

        guard isConnected else {
            statusText = mode == .barcode ? "Barcode saved" : "Text saved"
            return
        }

        Task {
            do {
                let receipt = try await transport.sendCaptureResult(
                    kind: mode == .barcode ? "barcode" : "text",
                    value: trimmed,
                    format: format,
                    capturedAt: capturedAt,
                    contributorId: contributorId
                )
                if receipt.insertedIntoCursor == true {
                    updateCapture(capture.id, status: "Inserted")
                    statusText = mode == .barcode ? "Barcode inserted" : "Text inserted"
                } else {
                    updateCapture(capture.id, status: "Received")
                    statusText = "Chrome received it, but no cursor target was available."
                    if let label = receipt.cursorTarget?.label {
                        targetHint = label
                    }
                }
            } catch {
                updateCapture(capture.id, status: "Failed")
                errorMessage = error.localizedDescription
                statusText = "Send failed"
            }
        }
    }

    @discardableResult
    private func handlePairingValue(_ value: String, invalidMessage: String?) -> Bool {
        guard let url = PairingURLParser.pairingURL(in: value) ?? URL(string: value) else {
            if let invalidMessage {
                errorMessage = invalidMessage
            }
            return false
        }

        let (session, mode) = PairingURLParser.parse(url)
        guard let session else {
            if let invalidMessage {
                errorMessage = invalidMessage
            }
            return false
        }

        if let mode {
            selectMode(mode)
        }
        pairingSession = session
        pairingURLText = url.absoluteString
        Task { await pair(session) }
        return true
    }

    private func updateCapture(_ id: UUID, status: String) {
        guard let index = captures.firstIndex(where: { $0.id == id }) else { return }
        captures[index].status = status
    }

    private func normalizedBarcodeScan(value: String, format: String) -> (value: String, format: String) {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if format == "ean13",
           trimmedValue.count == 13,
           trimmedValue.first == "0",
           trimmedValue.allSatisfy(\.isNumber) {
            return (String(trimmedValue.dropFirst()), "upc_a")
        }
        return (trimmedValue, format)
    }

    private func tab(for mode: CaptureMode) -> ClipTab {
        switch mode {
        case .dictation: .dictate
        case .photo: .upload
        case .ocr, .barcode: .capture
        }
    }
}
