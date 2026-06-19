import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scannerStoreSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerStore.swift", import.meta.url),
  "utf8"
);
const scannerStoreCaptureActionsSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerStoreCaptureActions.swift", import.meta.url),
  "utf8"
);
const scannerStoreDictationSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerStoreDictation.swift", import.meta.url),
  "utf8"
);
const dictationModelSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/DictationModel.swift", import.meta.url),
  "utf8"
);
const scannerSignalingSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerSignalingClient.swift", import.meta.url),
  "utf8"
);
const scannerProtocolSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerProtocol.swift", import.meta.url),
  "utf8"
);
const rootViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/RootView.swift", import.meta.url),
  "utf8"
);
const scannerViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/ScannerView.swift", import.meta.url),
  "utf8"
);
const captureSessionViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CaptureSessionView.swift", import.meta.url),
  "utf8"
);
const ocrReviewLayerSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/OcrReviewLayer.swift", import.meta.url),
  "utf8"
);
const textRecognizerSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/TextRecognizer.swift", import.meta.url),
  "utf8"
);
const dictationViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/DictationView.swift", import.meta.url),
  "utf8"
);
const uploadViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/ResultsView.swift", import.meta.url),
  "utf8"
);
const scannerWebRTCConnectionSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerWebRTCConnection.swift", import.meta.url),
  "utf8"
);

test("native saved-session reconnect re-registers durable pairing before requesting reconnect", () => {
  const reconnectStart = scannerStoreSwiftSource.indexOf("private func reconnectWithSavedPairing");
  const requestReconnectStart = scannerStoreSwiftSource.indexOf("let joinWindow = try await signaling.requestReconnect", reconnectStart);
  const registerStart = scannerStoreSwiftSource.indexOf("try await signaling.registerPairing", reconnectStart);

  assert.ok(reconnectStart > -1);
  assert.ok(registerStart > reconnectStart);
  assert.ok(requestReconnectStart > registerStart);
  assert.match(scannerStoreSwiftSource, /browserSessionId: pairedSession\.browserSessionId/);
  assert.match(scannerStoreSwiftSource, /pairingSecret: secret/);
  assert.match(scannerSignalingSwiftSource, /func registerPairing\(\n\s+pairingId: String,/);
  assert.match(scannerSignalingSwiftSource, /guard \(response as\? HTTPURLResponse\)\?\.statusCode == 200 else/);
});

test("native saved-session reconnect waits longer than QR pairing for sleeping Chrome extensions", () => {
  assert.match(scannerProtocolSwiftSource, /static let joinAttemptTTL: Duration = \.seconds\(32\)/);
  assert.match(scannerProtocolSwiftSource, /static let reconnectRequestTTL: Duration = \.seconds\(95\)/);
  assert.match(scannerProtocolSwiftSource, /static let iceGatheringTimeout: Duration = \.seconds\(2\)/);
  assert.match(scannerSignalingSwiftSource, /let deadline = ContinuousClock\.now \+ ScannerProtocol\.reconnectRequestTTL/);
});

test("native saved-session reconnect toast can cancel manual previous-session taps", () => {
  const reconnectStart = scannerStoreSwiftSource.indexOf("func reconnect(to pairedSession:");
  const reconnectEnd = scannerStoreSwiftSource.indexOf("func reconnectToMostRecentPairedSessionIfNeeded", reconnectStart);
  const reconnectSource = scannerStoreSwiftSource.slice(reconnectStart, reconnectEnd);

  assert.ok(reconnectStart > -1);
  assert.match(reconnectSource, /canCancelReconnect = true/);
  assert.doesNotMatch(reconnectSource, /canCancelReconnect = isAutomatic/);
  assert.match(scannerStoreSwiftSource, /func cancelReconnect\(\)/);
  assert.match(rootViewSwiftSource, /store\.cancelReconnect\(\)/);
  assert.match(rootViewSwiftSource, /actionTitle: store\.canCancelReconnect \? "Cancel" : nil/);
});

test("native capture session recovers pairing instead of dismissing when the scanner disconnects", () => {
  assert.match(scannerViewSwiftSource, /CaptureSessionView\(isPresented: \$isCaptureSessionPresented\)/);
  assert.match(scannerViewSwiftSource, /store\.connectionStatus\.isConnected/);
  assert.match(captureSessionViewSwiftSource, /\.onChange\(of: store\.connectionStatus\)/);
  assert.match(captureSessionViewSwiftSource, /handleConnectionStatusChange\(status\)/);
  assert.match(captureSessionViewSwiftSource, /store\.recoverMostRecentPairedSession\(\)/);
  assert.match(captureSessionViewSwiftSource, /PairingSessionsView\(\)/);
  assert.match(scannerStoreSwiftSource, /func recoverMostRecentPairedSession\(\) -> Bool/);
  assert.match(scannerStoreSwiftSource, /lastAutomaticReconnectAt = nil/);
  const recoveryStart = captureSessionViewSwiftSource.indexOf("private func handleConnectionStatusChange");
  const recoverySource = captureSessionViewSwiftSource.slice(recoveryStart);
  assert.ok(recoveryStart > -1);
  assert.doesNotMatch(recoverySource, /isPresented = false/);
});

test("native capture owns the sessions accessory instead of leaking it into the shared section header", () => {
  assert.match(rootViewSwiftSource, /struct ScannerSectionHeader<TrailingAccessory: View>: View/);
  assert.match(rootViewSwiftSource, /trailingAccessory\(\)/);
  assert.doesNotMatch(rootViewSwiftSource, /onSessions/);
  assert.match(rootViewSwiftSource, /struct ScannerSessionsButton: View/);
  assert.match(scannerViewSwiftSource, /ScannerSectionHeader\(\s*title: "Capture",[\s\S]*\) \{\s*ScannerSessionsButton/);
  assert.match(dictationViewSwiftSource, /ScannerSectionHeader\(title: "Dictate"[\s\S]*trailingAccessory: \{\s*ScannerSessionsButton/);
  assert.match(uploadViewSwiftSource, /ScannerSectionHeader\(title: "Upload"[\s\S]*trailingAccessory: \{\s*ScannerSessionsButton/);
});

test("native OCR review stops the live camera until retake", () => {
  assert.match(captureSessionViewSwiftSource, /struct CaptureSessionView/);
  assert.match(captureSessionViewSwiftSource, /\.onChange\(of: store\.ocrReviewImage != nil\)/);
  assert.match(captureSessionViewSwiftSource, /syncCameraForOcrReview\(isReviewingOcr: store\.ocrReviewImage != nil\)/);
  assert.match(captureSessionViewSwiftSource, /private func syncCameraForOcrReview\(isReviewingOcr: Bool\)/);
  assert.match(captureSessionViewSwiftSource, /if isReviewingOcr \{\s*store\.camera\.stop\(\)\s*\} else \{\s*store\.camera\.start\(\)\s*\}/);
});

test("native OCR review separates pan gestures from selectable text targets", () => {
  assert.match(ocrReviewLayerSwiftSource, /@State private var isPanning = false/);
  assert.match(ocrReviewLayerSwiftSource, /lastPanEndedAt = Date\(\)/);
  assert.match(ocrReviewLayerSwiftSource, /Date\(\)\.timeIntervalSince\(lastPanEndedAt\) > panSelectionSuppression/);
  assert.match(ocrReviewLayerSwiftSource, /minimumTapTargetSize \/ currentScale/);
});

test("native OCR review renders Vision quadrilaterals for angled text", () => {
  assert.match(textRecognizerSwiftSource, /struct TextQuadrilateral: Equatable/);
  assert.match(textRecognizerSwiftSource, /init\(observation: VNRectangleObservation\)/);
  assert.match(textRecognizerSwiftSource, /quadrilateral: TextQuadrilateral\(observation: observation\)/);
  assert.match(ocrReviewLayerSwiftSource, /OcrRegionShape\(points: points\)/);
  assert.match(ocrReviewLayerSwiftSource, /viewPoints\(for: region\.quadrilateral/);
});

test("native scanner normalizes UPC-A barcodes and upload filenames preserve selection order", () => {
  assert.match(scannerStoreCaptureActionsSwiftSource, /normalizedBarcodeScan\(value: value, format: camera\.lastBarcodeFormat \?\? "barcode"\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /trimmedValue\.count == 13/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /trimmedValue\.first == "0"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /return \(String\(trimmedValue\.dropFirst\(\)\), "upc_a"\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /String\(format: "%03d", index \+ 1\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /filename: uploadFilename\(index: index, capturedAt: capturedAt\)/);
});

test("native dictation keeps listening briefly after user stop actions", () => {
  assert.match(scannerStoreSwiftSource, /let dictationReleaseGraceDelay: Duration = \.milliseconds\(1500\)/);
  assert.match(scannerStoreDictationSwiftSource, /func finishDictationAfterGrace\(\)/);
  assert.match(scannerStoreDictationSwiftSource, /try\? await Task\.sleep\(for: delay\)/);
  assert.match(scannerStoreDictationSwiftSource, /cancelDictationGraceStop\(\)/);
  assert.match(dictationViewSwiftSource, /private func stopDictation\(\) \{\s*store\.finishDictationAfterGrace\(\)\s*\}/);
  assert.match(dictationViewSwiftSource, /holdEndAction: stopDictation/);
});

test("native dictation recognition results do not automatically stop recording", () => {
  const recognitionTaskStart = dictationModelSwiftSource.indexOf("nonisolated private static func makeRecognitionTask");
  const recognitionTaskSource = dictationModelSwiftSource.slice(recognitionTaskStart);

  assert.ok(recognitionTaskStart > -1);
  assert.doesNotMatch(recognitionTaskSource, /result\?\.isFinal[\s\S]*owner\?\.stop\(\)/);
  assert.doesNotMatch(recognitionTaskSource, /error\s*!=\s*nil[\s\S]*owner\?\.stop\(\)/);
});

test("native Chrome input-change haptics are gated to the Dictate tab", () => {
  assert.match(scannerStoreSwiftSource, /func applyConnectionStatus\(_ status: ScannerConnectionStatus, allowsConnectedFeedback: Bool = true\)/);
  assert.match(scannerStoreSwiftSource, /if allowsConnectedFeedback \{\s*pairingNotificationFeedback\.notificationOccurred\(\.success\)\s*\}/);
  assert.match(scannerStoreSwiftSource, /let didChangeChromeInputTarget: Bool/);
  assert.match(scannerStoreSwiftSource, /wasConnected && dictationTargetKey\(for: previousPeerTarget\) != dictationTargetKey\(for: nextPeerTarget\)/);
  assert.match(scannerStoreSwiftSource, /allowsConnectedFeedback: !wasConnected \|\| \(didChangeChromeInputTarget && selectedSection == \.dictation\)/);
  assert.doesNotMatch(scannerStoreSwiftSource, /allowsConnectedFeedback: !didChangeChromeInputTarget \|\| selectedSection == \.dictation/);
  assert.match(scannerViewSwiftSource, /\.onAppear \{\s*store\.selectedSection = \.scan\s*store\.activeMode = \.ocr\s*\}/);
  assert.match(dictationViewSwiftSource, /\.onAppear \{\s*store\.selectedSection = \.dictation\s*store\.activeMode = \.dictation\s*\}/);
  assert.match(uploadViewSwiftSource, /\.onAppear \{\s*store\.selectedSection = \.upload\s*\}/);
  assert.match(scannerStoreDictationSwiftSource, /func allowsDictationFeedback\(_ requested: Bool = true\) -> Bool \{\s*requested && selectedSection == \.dictation\s*\}/);
  assert.match(scannerStoreDictationSwiftSource, /if allowsDictationFeedback\(allowsFeedback\) \{\s*dictationNotificationFeedback\.notificationOccurred\(\.success\)\s*\}/);
  assert.match(scannerStoreDictationSwiftSource, /if wasRecording, allowsDictationFeedback\(\) \{\s*dictationImpactFeedback\.impactOccurred\(intensity: 0\.7\)\s*\}/);
});

test("native scanner handles Chrome result receipts for cursor insertion feedback", () => {
  assert.match(scannerProtocolSwiftSource, /struct ResultReceived: Decodable, Equatable/);
  assert.match(scannerProtocolSwiftSource, /static func parseResultReceived\(_ rawValue: String\) -> ResultReceived\?/);
  assert.match(scannerWebRTCConnectionSwiftSource, /var onResultReceived: \(\(ScannerProtocol\.ResultReceived\) -> Void\)\?/);
  assert.match(scannerWebRTCConnectionSwiftSource, /ScannerProtocol\.parseResultReceived\(rawValue\)/);
  assert.match(scannerStoreSwiftSource, /func applyResultReceived\(_ receipt: ScannerProtocol\.ResultReceived\)/);
  assert.match(scannerStoreSwiftSource, /receipt\.insertedIntoCursor == false/);
  assert.match(scannerStoreSwiftSource, /if receipt\.savedToResults \{\s*showCaptureTypingFallbackToast\(for: results\[index\]\)\s*\} else \{\s*showCaptureDeliveryToast\(for: results\[index\], state: \.failed\)\s*\}/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func showCaptureTypingFallbackToast\(for result: ScanResult\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /title: "Failed to type"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /was saved to Chrome sidepanel results/);
  assert.match(scannerStoreSwiftSource, /Chrome saved it, but no focused cursor target was available\./);
});
