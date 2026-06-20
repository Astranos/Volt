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
const cameraModelSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/CameraModel.swift", import.meta.url),
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
const pairingSessionsViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/PairingSessionsView.swift", import.meta.url),
  "utf8"
);
const scannerViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/ScannerView.swift", import.meta.url),
  "utf8"
);
const scannerCameraLayerSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/ScannerCameraLayer.swift", import.meta.url),
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

test("native Debug builds use Convex dev and Release builds use Convex production", () => {
  assert.match(scannerProtocolSwiftSource, /#if DEBUG/);
  assert.match(scannerProtocolSwiftSource, /https:\/\/adorable-hornet-19\.convex\.site\/api\/signal/);
  assert.match(scannerProtocolSwiftSource, /#else/);
  assert.match(scannerProtocolSwiftSource, /https:\/\/sincere-trout-414\.convex\.site\/api\/signal/);
  assert.match(scannerProtocolSwiftSource, /#endif/);
});

test("native saved-session reconnect toast can cancel manual previous-session taps", () => {
  const reconnectStart = scannerStoreSwiftSource.indexOf("func reconnect(to pairedSession:");
  const reconnectEnd = scannerStoreSwiftSource.indexOf("func reconnectToMostRecentPairedSessionIfNeeded", reconnectStart);
  const reconnectSource = scannerStoreSwiftSource.slice(reconnectStart, reconnectEnd);

  assert.ok(reconnectStart > -1);
  assert.match(reconnectSource, /canCancelReconnect = true/);
  assert.doesNotMatch(reconnectSource, /canCancelReconnect = isAutomatic/);
  assert.match(scannerStoreSwiftSource, /func cancelReconnect\(\)/);
  assert.match(scannerStoreSwiftSource, /func cancelConnectionAttempt\(\)/);
  assert.match(scannerStoreSwiftSource, /connectionStatus\.isConnecting/);
  assert.match(rootViewSwiftSource, /store\.cancelConnectionAttempt\(\)/);
  assert.match(rootViewSwiftSource, /canCancel: true/);
  assert.match(rootViewSwiftSource, /if sheet\.canCancel \{\s*Button\(role: \.cancel, action: onCancel\)/);
});

test("native connection sheet is always visible while connecting and user dismissal cancels", () => {
  assert.match(rootViewSwiftSource, /\.sheet\(isPresented: \$isConnectionSheetPresented, onDismiss: handleConnectionSheetDismiss\)/);
  assert.doesNotMatch(rootViewSwiftSource, /interactiveDismissDisabled\(connectionSheetStatus\.isProgressing\)/);
  assert.match(rootViewSwiftSource, /case \.pairing:\s*keepsConnectionSheetOpenForSessions = false[\s\S]*isConnectionSheetPresented = true/);
  assert.match(rootViewSwiftSource, /case \.waitingForChrome:\s*keepsConnectionSheetOpenForSessions = false[\s\S]*isConnectionSheetPresented = true/);
  assert.match(rootViewSwiftSource, /private func handleConnectionSheetDismiss\(\) \{[\s\S]*if isConnectionAttemptVisible \{\s*store\.cancelConnectionAttempt\(\)\s*\}[\s\S]*resetConnectionSheetPresentation\(\)/);
  assert.match(rootViewSwiftSource, /private var isConnectionAttemptVisible: Bool \{[\s\S]*case \.pairing, \.waitingForChrome:/);
});

test("native saved-session taps intentionally dismiss sessions before reconnect sheet returns", () => {
  assert.match(rootViewSwiftSource, /PairingSessionsView \{\s*beginReconnectFromConnectionSheetSessions\(\)\s*\}/);
  assert.match(rootViewSwiftSource, /@State private var allowsNextConnectionSheetDismissal = false/);
  assert.match(rootViewSwiftSource, /private func beginReconnectFromConnectionSheetSessions\(\) \{\s*allowsNextConnectionSheetDismissal = true\s*keepsConnectionSheetOpenForSessions = false\s*connectionSheetStatus = nil\s*connectionSheetDetent = Self\.connectionStatusDetent\s*\}/);
  assert.match(rootViewSwiftSource, /private func handleConnectionSheetDismiss\(\) \{\s*if allowsNextConnectionSheetDismissal \{\s*allowsNextConnectionSheetDismissal = false\s*resetConnectionSheetPresentation\(\)\s*showPairingSheet\(for: store\.connectionStatus\)\s*return\s*\}/);
  assert.match(pairingSessionsViewSwiftSource, /let onReconnectStarted: \(\) -> Void/);
  assert.match(pairingSessionsViewSwiftSource, /init\(onReconnectStarted: @escaping \(\) -> Void = \{\}\)/);
  assert.match(pairingSessionsViewSwiftSource, /Button \{\s*onReconnectStarted\(\)\s*store\.reconnect\(to: session\)\s*dismiss\(\)/);
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

test("native screens use the shared header connection control without extra session accessories", () => {
  assert.match(rootViewSwiftSource, /struct ScannerSectionHeader<TrailingAccessory: View>: View/);
  assert.match(rootViewSwiftSource, /trailingAccessory\(\)/);
  assert.doesNotMatch(rootViewSwiftSource, /onSessions/);
  assert.doesNotMatch(rootViewSwiftSource, /struct ScannerSessionsButton: View/);
  assert.match(scannerViewSwiftSource, /ScannerSectionHeader\(\s*title: "Capture",\s*onConnectionControlTapped:/);
  assert.match(dictationViewSwiftSource, /ScannerSectionHeader\(\s*title: "Dictate",\s*onConnectionControlTapped:/);
  assert.match(uploadViewSwiftSource, /ScannerSectionHeader\(\s*title: "Upload",\s*onConnectionControlTapped:/);
  assert.doesNotMatch(scannerViewSwiftSource, /trailingAccessory: \{\s*ScannerSessionsButton/);
  assert.doesNotMatch(dictationViewSwiftSource, /trailingAccessory: \{\s*ScannerSessionsButton/);
  assert.doesNotMatch(uploadViewSwiftSource, /trailingAccessory: \{\s*ScannerSessionsButton/);
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

test("native OCR review keeps raw Vision text until selected cleanup is requested", () => {
  assert.match(textRecognizerSwiftSource, /import FoundationModels/);
  assert.match(textRecognizerSwiftSource, /enum OcrTextCleaner/);
  assert.match(textRecognizerSwiftSource, /static func clean\(text: String\) async -> OcrTextCleanupResult/);
  assert.match(textRecognizerSwiftSource, /SystemLanguageModel\(/);
  assert.match(textRecognizerSwiftSource, /LanguageModelSession\(/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /ocrTextRegions = try await TextRecognizer\.recognizeTextRegions\(in: preparedImage\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /ocrReviewText = ocrTextRegions\.map\(\\\.text\)\.joined\(separator: "\\n"\)/);
  assert.doesNotMatch(scannerStoreCaptureActionsSwiftSource, /OcrTextCleaner\.clean/);
});

test("native OCR target dialog can clean selected text before sending", () => {
  assert.match(captureSessionViewSwiftSource, /Button\("Send", systemImage: "paperplane\.fill"\)/);
  assert.match(captureSessionViewSwiftSource, /Button\(isCleaningSelectedText \? "Cleaning\.\.\." : "Cleanup", systemImage: "wand\.and\.sparkles"\)/);
  assert.match(captureSessionViewSwiftSource, /store\.sendRecognizedText\(selectedCleanedText \?\? selectedTextRegion\.text\)/);
  assert.match(captureSessionViewSwiftSource, /let result = await OcrTextCleaner\.clean\(text: region\.text\)/);
  assert.match(captureSessionViewSwiftSource, /private var selectedTextPreview: String/);
});

test("native scanner normalizes UPC-A barcodes and upload filenames preserve selection order", () => {
  assert.match(scannerStoreCaptureActionsSwiftSource, /normalizedBarcodeScan\(value: value, format: camera\.lastBarcodeFormat \?\? "barcode"\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /trimmedValue\.count == 13/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /trimmedValue\.first == "0"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /return \(String\(trimmedValue\.dropFirst\(\)\), "upc_a"\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /String\(format: "%03d", index \+ 1\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /filename: uploadFilename\(index: index, capturedAt: capturedAt\)/);
});

test("native barcode scanning favors guided UPC codes over adjacent supplemental barcodes", () => {
  assert.match(cameraModelSwiftSource, /private struct BarcodeCandidate/);
  assert.match(cameraModelSwiftSource, /barcodeGuideOverlapRatio\(candidate\.bounds, guideRect\) >= 0\.35/);
  assert.match(cameraModelSwiftSource, /let retailCandidates = guidedCandidates\.filter\(isRetailUPCorEAN\)/);
  assert.match(cameraModelSwiftSource, /let selectableCandidates = retailCandidates\.isEmpty \? guidedCandidates : retailCandidates/);
  assert.match(cameraModelSwiftSource, /private func barcodeGuideScore/);
  assert.match(cameraModelSwiftSource, /if isSupplementalRetailCode\(candidate\.value\) \{\s*score \+= 4_000\s*\}/);
  assert.match(cameraModelSwiftSource, /score -= widthRatio \* 480/);
});

test("native barcode recognition defaults to UPC with settings override", () => {
  assert.match(cameraModelSwiftSource, /enum BarcodeRecognitionMode: String, CaseIterable, Identifiable/);
  assert.match(cameraModelSwiftSource, /case upc = "upc"/);
  assert.match(cameraModelSwiftSource, /var barcodeRecognitionMode: BarcodeRecognitionMode = \.upc/);
  assert.match(cameraModelSwiftSource, /case \.upc:\s*\[\.ean13, \.ean8, \.upce\]/);
  assert.match(cameraModelSwiftSource, /case \.all:\s*Self\.allSupportedMetadataObjectTypes/);
  assert.match(cameraModelSwiftSource, /func updateBarcodeRecognitionMode\(_ mode: BarcodeRecognitionMode\)/);
  assert.match(scannerStoreSwiftSource, /static let barcodeRecognitionModeStorageKey = "volt\.barcodeRecognitionMode\.v1"/);
  assert.match(scannerStoreSwiftSource, /var barcodeRecognitionMode: BarcodeRecognitionMode = \.upc/);
  assert.match(scannerStoreSwiftSource, /UserDefaults\.standard\.set\(barcodeRecognitionMode\.rawValue, forKey: Self\.barcodeRecognitionModeStorageKey\)/);
  assert.match(scannerStoreSwiftSource, /camera\.updateBarcodeRecognitionMode\(barcodeRecognitionMode\)/);
  assert.match(rootViewSwiftSource, /SettingsView\(\)\s*\.tabItem \{ Label\("Settings", systemImage: "gearshape"\) \}/);
  assert.match(rootViewSwiftSource, /Picker\("Recognized Codes", selection: \$store\.barcodeRecognitionMode\)/);
  assert.match(rootViewSwiftSource, /ForEach\(BarcodeRecognitionMode\.allCases\)/);
});

test("native barcode reticles expire when detections stop refreshing", () => {
  assert.match(cameraModelSwiftSource, /private var barcodeDetectionRevision = 0/);
  assert.match(cameraModelSwiftSource, /private var barcodeClearTask: Task<Void, Never>\?/);
  assert.match(cameraModelSwiftSource, /func clearDetectedBarcode\(\) \{\s*barcodeDetectionRevision \+= 1\s*barcodeClearTask\?\.cancel\(\)\s*barcodeClearTask = nil/);
  assert.match(cameraModelSwiftSource, /scheduleStaleBarcodeClear\(\)/);
  assert.match(cameraModelSwiftSource, /try\? await Task\.sleep\(for: \.milliseconds\(450\)\)/);
  assert.match(cameraModelSwiftSource, /self\.barcodeDetectionRevision == revision/);
  assert.match(cameraModelSwiftSource, /self\.clearDetectedBarcode\(\)/);
});

test("native barcode reticle only renders in barcode capture mode", () => {
  assert.match(scannerCameraLayerSwiftSource, /guard store\.activeMode == \.barcode else \{\s*store\.camera\.updateBarcodeGuideRect\(nil\)\s*store\.camera\.clearDetectedBarcode\(\)/);
  assert.match(scannerCameraLayerSwiftSource, /if guideVisible \{\s*store\.camera\.updateBarcodeGuideRect\(/);
  assert.match(scannerCameraLayerSwiftSource, /else \{\s*store\.camera\.updateBarcodeGuideRect\(nil\)\s*\}/);
  assert.match(scannerCameraLayerSwiftSource, /if guideVisible,\s*store\.activeMode == \.barcode,\s*let barcodeBounds = store\.camera\.detectedBarcodeBounds/);
});

test("native pairing QR scan temporarily enables QR recognition without clearing hidden-guide detections", () => {
  assert.match(pairingSessionsViewSwiftSource, /@State private var previousBarcodeRecognitionMode: BarcodeRecognitionMode\?/);
  assert.match(pairingSessionsViewSwiftSource, /previousBarcodeRecognitionMode = store\.camera\.barcodeRecognitionMode/);
  assert.match(pairingSessionsViewSwiftSource, /store\.camera\.updateBarcodeRecognitionMode\(\.qr\)/);
  assert.match(pairingSessionsViewSwiftSource, /if let previousBarcodeRecognitionMode \{\s*store\.camera\.updateBarcodeRecognitionMode\(previousBarcodeRecognitionMode\)/);
  assert.match(pairingSessionsViewSwiftSource, /ScannerCameraLayer\(guideVisible: false\)/);
});

test("native camera resets capture sessions to display 1x zoom", () => {
  const startSource = cameraModelSwiftSource.slice(
    cameraModelSwiftSource.indexOf("func start()"),
    cameraModelSwiftSource.indexOf("func stop()")
  );

  assert.match(startSource, /resetZoomToDisplayOne\(for: videoDevice\)/);
  assert.match(cameraModelSwiftSource, /nonisolated private func resetZoomToDisplayOne\(for device: AVCaptureDevice\)/);
  assert.match(cameraModelSwiftSource, /clampedRawZoomFactor\(1 \/ displayZoomFactorMultiplier\(for: device\), for: device\)/);
  assert.match(cameraModelSwiftSource, /device\.videoZoomFactor = rawZoomFactor/);
  assert.match(cameraModelSwiftSource, /updateZoomState\(for: device, rawZoomFactor: rawZoomFactor\)/);
});

test("native dictation keeps listening briefly after user stop actions", () => {
  assert.match(scannerStoreSwiftSource, /let dictationReleaseGraceDelay: Duration = \.milliseconds\(1500\)/);
  assert.match(scannerStoreDictationSwiftSource, /func finishDictationAfterGrace\(\)/);
  assert.match(scannerStoreDictationSwiftSource, /try\? await Task\.sleep\(for: delay\)/);
  assert.match(scannerStoreDictationSwiftSource, /cancelDictationGraceStop\(\)/);
  assert.match(dictationViewSwiftSource, /private func stopDictation\(\) \{\s*store\.finishDictationAfterGrace\(\)\s*\}/);
  assert.match(dictationViewSwiftSource, /holdEndAction: stopDictation/);
});

test("native dictation start gesture emits a dedicated start haptic", () => {
  const pressGestureStart = dictationViewSwiftSource.indexOf("private var pressGesture");
  const pressGestureSource = dictationViewSwiftSource.slice(pressGestureStart);

  assert.ok(pressGestureStart > -1);
  assert.match(pressGestureSource, /if !isRecording && !isStarting \{[\s\S]*startFeedback\.prepare\(\)[\s\S]*startFeedback\.impactOccurred\(intensity: 1\)[\s\S]*holdStartAction\(\)/);
  assert.doesNotMatch(pressGestureSource, /pressFeedback\.impactOccurred\(intensity: 1\)[\s\S]*if !isRecording && !isStarting/);
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
