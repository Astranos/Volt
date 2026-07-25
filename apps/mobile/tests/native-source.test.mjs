import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { scannerProtocolGolden } from "@volt/scanner-protocol/protocol-fixtures";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function swiftStringArrayLiteral(values) {
  return `\\[${values.map((value) => `"${escapeRegExp(value)}"`).join(", ")}\\]`;
}

function swiftRawValueList(values) {
  return values.map((value) => `MessageType\\.${value}.rawValue`).join(",\\s*");
}

const appSwiftSource = readFileSync(
  new URL("../ios/Volt/App/VoltApp.swift", import.meta.url),
  "utf8"
);
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
const cameraZoomControllerSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/CameraZoomController.swift", import.meta.url),
  "utf8"
);
const cameraDeviceSelectorSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/CameraDeviceSelector.swift", import.meta.url),
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
const pairingURLParserSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/PairingURLParser.swift", import.meta.url),
  "utf8"
);
const scannerRecognitionModelsSwiftSource = readFileSync(
  new URL("../ios/Volt/Models/ScannerRecognitionModels.swift", import.meta.url),
  "utf8"
);
const rootViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/RootView.swift", import.meta.url),
  "utf8"
);
const settingsViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SettingsView.swift", import.meta.url),
  "utf8"
);
const scannerViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/ScannerView.swift", import.meta.url),
  "utf8"
);
const captureModeCardsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CaptureModeCards.swift", import.meta.url),
  "utf8"
);
const sessionsViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SessionsView.swift", import.meta.url),
  "utf8"
);
const cloudTargetPickerSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CloudTargetPickerSheet.swift", import.meta.url),
  "utf8"
);
const capturedResultRowSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CapturedResultRow.swift", import.meta.url),
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
const cameraSessionControlsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CameraSessionControls.swift", import.meta.url),
  "utf8"
);
const sharedCameraSessionControlsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SharedCameraSessionControls.swift", import.meta.url),
  "utf8"
);
const sharedScannerTabComponentsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SharedScannerTabComponents.swift", import.meta.url),
  "utf8"
);
const sharedPairingSessionComponentsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SharedPairingSessionComponents.swift", import.meta.url),
  "utf8"
);
const sharedCaptureSessionOverlaysSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SharedCaptureSessionOverlays.swift", import.meta.url),
  "utf8"
);
const cameraPreviewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CameraPreview.swift", import.meta.url),
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
const ocrTextCleanerSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/OcrTextCleaner.swift", import.meta.url),
  "utf8"
);
const uploadViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/ResultsView.swift", import.meta.url),
  "utf8"
);
const clipRootViewSwiftSource = readFileSync(
  new URL("../ios/VoltClip/Views/ClipRootView.swift", import.meta.url),
  "utf8"
);
const clipBarcodeScannerServiceSwiftSource = readFileSync(
  new URL("../ios/VoltClip/Services/ClipBarcodeScannerService.swift", import.meta.url),
  "utf8"
);
const clipScannerStoreSwiftSource = readFileSync(
  new URL("../ios/VoltClip/Services/ClipScannerStore.swift", import.meta.url),
  "utf8"
);
const clipOCRServiceSwiftSource = readFileSync(
  new URL("../ios/VoltClip/Services/ClipOCRService.swift", import.meta.url),
  "utf8"
);
const clipTransportSwiftSource = readFileSync(
  new URL("../ios/VoltClip/Services/WebKitWebRTCTransport.swift", import.meta.url),
  "utf8"
);
const clipWebRTCBridgeSource = readFileSync(
  new URL("../ios/VoltClip/Resources/webrtc-bridge.html", import.meta.url),
  "utf8"
);
const xcodeProjectSource = readFileSync(
  new URL("../ios/Volt.xcodeproj/project.pbxproj", import.meta.url),
  "utf8"
);
const infoPlistSource = readFileSync(
  new URL("../ios/Volt/Info.plist", import.meta.url),
  "utf8"
);
const podfileSource = readFileSync(
  new URL("../ios/Podfile", import.meta.url),
  "utf8"
);

const removedFullAppSources = [
  "ScannerWebRTCConnection.swift",
  "ScannerStorePairedSessions.swift",
  "ScannerStoreDictation.swift",
  "DictationModel.swift",
  "PairingSessionsView.swift",
  "DictationView.swift",
];

test("installed app excludes WebRTC pairing and dictation sources without changing App Clip membership", () => {
  for (const filename of removedFullAppSources) {
    assert.equal(existsSync(new URL(`../ios/Volt/Services/${filename}`, import.meta.url)), false);
    assert.equal(existsSync(new URL(`../ios/Volt/Views/${filename}`, import.meta.url)), false);
    assert.doesNotMatch(xcodeProjectSource, new RegExp(escapeRegExp(filename)));
  }
  assert.doesNotMatch(appSwiftSource, /PairingURLParser|volt:\/\/pair/);
  assert.doesNotMatch(scannerStoreSwiftSource, /ScannerWebRTCConnection|ScannerSignalingClient|PairingURLParser|PairingSecretStore|connectionStatus|peerTarget|DictationModel/);
  assert.doesNotMatch(scannerStoreCaptureActionsSwiftSource, /sendCaptureResultOverWebRTC|photoRetryQueue|sendRetryablePhotos|sendQueuedPhoto|sendDictation/);
  assert.doesNotMatch(rootViewSwiftSource, /DictationView|PairingSessionsView|PairingStatusSheet|case dictation/);
  assert.doesNotMatch(infoPlistSource, /NSMicrophoneUsageDescription|NSSpeechRecognitionUsageDescription/);
  assert.doesNotMatch(podfileSource, /JitsiWebRTC/);
  assert.doesNotMatch(scannerProtocolSwiftSource, /PhotoDeliveryReceipt|struct PhotoChunkAck|parsePhotoChunkAck|static func helloMessage|static func dictationMessage/);
  assert.match(sessionsViewSwiftSource, /store\.results\.filter \{ \$0\.source != \.upload \}/);
  assert.match(sessionsViewSwiftSource, /canResend: result\.kind != \.dictation/);
  assert.match(capturedResultRowSwiftSource, /case \.dictation: "Dictation"/);
  assert.match(capturedResultRowSwiftSource, /case \.dictation: "mic"/);
  assert.match(xcodeProjectSource, /B3000000000000000000000D \/\* ScannerProtocol\.swift in Sources \*\//);
  assert.match(xcodeProjectSource, /B3000000000000000000000E \/\* ScannerSignalingClient\.swift in Sources \*\//);
  assert.match(xcodeProjectSource, /B3000000000000000000000C \/\* PairingURLParser\.swift in Sources \*\//);
  assert.match(xcodeProjectSource, /B30000000000000000000020 \/\* PairingSecretStore\.swift in Sources \*\//);
});

test("App Clip saved-session reconnect waits longer than QR pairing for sleeping Chrome extensions", () => {
  assert.match(scannerProtocolSwiftSource, new RegExp(`static let joinAttemptTTL: Duration = \\.seconds\\(${scannerProtocolGolden.timing.joinAttemptTtlMs / 1000}\\)`));
  assert.match(scannerProtocolSwiftSource, new RegExp(`static let reconnectRequestTTL: Duration = \\.seconds\\(${scannerProtocolGolden.timing.reconnectRequestTtlMs / 1000}\\)`));
  assert.match(scannerProtocolSwiftSource, new RegExp(`static let iceGatheringTimeout: Duration = \\.seconds\\(${scannerProtocolGolden.timing.iceGatheringTimeoutMs / 1000}\\)`));
  assert.match(scannerSignalingSwiftSource, /let deadline = ContinuousClock\.now \+ ScannerProtocol\.reconnectRequestTTL/);
});

test("native signaling errors preserve rejected status and server detail", () => {
  assert.match(scannerProtocolSwiftSource, /case signalRejected\(statusCode: Int, detail: String\?\)/);
  assert.match(scannerProtocolSwiftSource, /The scanner signaling service rejected the request/);
  assert.match(scannerSignalingSwiftSource, /private func signalRejectedError\(data: Data, statusCode: Int\?\) -> ScannerPairingError/);
  assert.match(scannerSignalingSwiftSource, /payload\["error"\] as\? String/);
});

test("native Debug builds use Convex dev and Release builds use Convex production", () => {
  assert.match(scannerProtocolSwiftSource, /#if DEBUG/);
  assert.match(scannerProtocolSwiftSource, new RegExp(escapeRegExp(scannerProtocolGolden.urls.signalDev)));
  assert.match(scannerProtocolSwiftSource, /#else/);
  assert.match(scannerProtocolSwiftSource, new RegExp(escapeRegExp(scannerProtocolGolden.urls.signalProd)));
  assert.match(scannerProtocolSwiftSource, /#endif/);
});

test("native scanner protocol constants match shared scanner protocol fixtures", () => {
  assert.match(scannerProtocolSwiftSource, new RegExp(`static let controlChannelLabel = "${scannerProtocolGolden.labels.controlChannel}"`));
  assert.match(scannerProtocolSwiftSource, new RegExp(`static let photoTransferChannelLabel = "${scannerProtocolGolden.labels.photoTransferChannel}"`));
  assert.match(
    scannerProtocolSwiftSource,
    new RegExp(
      `static let protocolVersion = ProtocolVersion\\(major: ${scannerProtocolGolden.protocolVersion.major}, minor: ${scannerProtocolGolden.protocolVersion.minor}, patch: ${scannerProtocolGolden.protocolVersion.patch}\\)`
    )
  );
  assert.match(scannerProtocolSwiftSource, new RegExp(`static let chunkSize = ${scannerProtocolGolden.photo.chunkSizeBytes / 1024} \\* 1024`));
  assert.match(scannerProtocolSwiftSource, new RegExp(`static let photoReceiptTimeout: Duration = \\.seconds\\(${scannerProtocolGolden.timing.photoReceiptTimeoutMs / 1000}\\)`));
  assert.match(
    scannerProtocolSwiftSource,
    new RegExp(`static let supportedCapabilities = ${swiftStringArrayLiteral(scannerProtocolGolden.surface.mobileCapabilities)}`)
  );
  assert.match(
    scannerProtocolSwiftSource,
    new RegExp(`static let supportedPeerPlatforms = ${swiftStringArrayLiteral(scannerProtocolGolden.surface.peerPlatforms)}`)
  );
  assert.match(
    clipWebRTCBridgeSource,
    new RegExp(`capabilities: ${swiftStringArrayLiteral(scannerProtocolGolden.surface.mobileCapabilities)}`)
  );
});

test("native scanner protocol message surfaces match shared scanner protocol fixtures", () => {
  const swiftControlCases = {
    hello: "hello",
    session_ready: "sessionReady",
    mode_changed: "modeChanged",
    capture_result: "captureResult",
    dictation: "dictation",
    result_received: "resultReceived",
    photo_chunk_ack: "photoChunkAck",
    photo_received: "photoReceived",
    photo_rejected: "photoRejected",
    protocol_error: "protocolError",
    session_closed: "sessionClosed",
  };
  const swiftPhotoCases = {
    photo_start: "photoStart",
    photo_chunk: "photoChunk",
    photo_complete: "photoComplete",
    photo_cancel: "photoCancel",
  };

  for (const type of scannerProtocolGolden.surface.controlMessageTypes) {
    assert.match(scannerProtocolSwiftSource, new RegExp(`case ${swiftControlCases[type]}(?: = "${type}")?`));
  }
  for (const type of scannerProtocolGolden.surface.photoTransferMessageTypes) {
    assert.match(scannerProtocolSwiftSource, new RegExp(`case ${swiftPhotoCases[type]} = "${type}"`));
  }

  const expectedControlRawValues = scannerProtocolGolden.surface.controlMessageTypes.map((type) => swiftControlCases[type]);
  const expectedPhotoRawValues = scannerProtocolGolden.surface.photoTransferMessageTypes.map((type) => swiftPhotoCases[type]);
  assert.match(scannerProtocolSwiftSource, new RegExp(`static let controlMessageTypes: \\[String\\] = \\[\\s*${swiftRawValueList(expectedControlRawValues)},?\\s*\\]`));
  assert.match(scannerProtocolSwiftSource, new RegExp(`static let photoTransferMessageTypes: \\[String\\] = \\[\\s*${swiftRawValueList(expectedPhotoRawValues)},?\\s*\\]`));
});

test("native pairing URLs can carry the signal deployment that minted the token", () => {
  assert.match(pairingURLParserSwiftSource, /signalURL: query\["signalUrl"\]\.flatMap\(URL\.init\(string:\)\)\?\.signalBaseURL \?\? url\.signalBaseURL/);
  assert.match(pairingURLParserSwiftSource, /guard parts\.count >= 4, parts\[0\] == "api", parts\[1\] == "signal", parts\[2\] == "join-token"/);
  assert.doesNotMatch(pairingURLParserSwiftSource, /url\.host == ScannerProtocol\.signalURL\.host/);
  assert.match(scannerProtocolSwiftSource, /static let developmentSignalURL = URL\(string: "https:\/\/adorable-hornet-19\.convex\.site\/api\/signal"\)!/);
  assert.match(scannerProtocolSwiftSource, /static let productionSignalURL = URL\(string: "https:\/\/sincere-trout-414\.convex\.site\/api\/signal"\)!/);
  assert.match(scannerProtocolSwiftSource, /#if DEBUG[\s\S]*static let fallbackSignalURLs = \[productionSignalURL\]/);
  assert.match(scannerSignalingSwiftSource, /func createJoinAttempt\([\s\S]*signalURL: URL = ScannerProtocol\.signalURL/);
  assert.match(scannerSignalingSwiftSource, /let url = signalURL[\s\S]*\.appending\(path: "join-token"\)/);
  assert.match(scannerSignalingSwiftSource, /func createJoinAttemptResolvingSignalURL\([\s\S]*allowFallback: Bool/);
  assert.match(scannerSignalingSwiftSource, /ScannerProtocol\.fallbackSignalURLs/);
  assert.match(scannerSignalingSwiftSource, /where statusCode == 404 && detail == "Join token not found" && allowFallback/);
  assert.match(clipTransportSwiftSource, /createJoinAttemptResolvingSignalURL\([\s\S]*allowFallback: session\.signalURL == nil/);
  assert.match(clipTransportSwiftSource, /fetchIceServerConfiguration\([\s\S]*signalURL: resolved\.signalURL/);
});

test("native capture session remains available without a WebRTC connection", () => {
  assert.match(scannerViewSwiftSource, /CaptureSessionView\(\s*isPresented: \$isCaptureSessionPresented,\s*mode: mode\s*\)/);
  assert.match(scannerViewSwiftSource, /CaptureModeLaunchCard\(mode: mode, action: startCapture\)/);
  assert.doesNotMatch(scannerViewSwiftSource, /guard store\.connectionStatus\.isConnected/);
  assert.match(captureSessionViewSwiftSource, /isCaptureEnabled: true/);
  assert.doesNotMatch(captureSessionViewSwiftSource, /\.onChange\(of: store\.connectionStatus\)/);
  assert.doesNotMatch(captureSessionViewSwiftSource, /isConnectionRecoveryPresented|handleConnectionStatusChange/);
  assert.doesNotMatch(scannerStoreSwiftSource, /func recoverMostRecentPairedSession\(\) -> Bool/);
});

test("capture mode tabs start from the hero card and list their own captures", () => {
  // The bottom accessory duplicated the hero launch card, so the tab keeps only the card.
  assert.doesNotMatch(scannerViewSwiftSource, /ScannerBottomActionAccessory/);
  assert.doesNotMatch(scannerViewSwiftSource, /safeAreaInset/);
  assert.doesNotMatch(scannerViewSwiftSource, /bottomAccessoryContentPadding/);
  // The App Clip still needs its accessory, so the shared component stays.
  assert.match(clipRootViewSwiftSource, /ScannerBottomActionAccessory/);

  // A saved-item count is replaced by the captures themselves.
  assert.doesNotMatch(captureModeCardsSwiftSource, /CaptureModeActivityCard/);
  assert.match(captureModeCardsSwiftSource, /struct CaptureModeCapturesSection: View/);
  assert.match(captureModeCardsSwiftSource, /Text\("Recent \\\(mode\.activityNoun\)"\)/);
  assert.match(captureModeCardsSwiftSource, /Array\(results\.prefix\(mode == \.photo \? 9 : 5\)\)/);
  assert.match(captureModeCardsSwiftSource, /mode == \.photo \{\s*photoGrid/);
  assert.match(captureModeCardsSwiftSource, /LazyVGrid\(columns: photoColumns/);
  assert.match(captureModeCardsSwiftSource, /CapturedResultRow\(\s*result: result,\s*canResend: true/);
  // Truncation is disclosed rather than silent.
  assert.match(captureModeCardsSwiftSource, /Text\("\\\(hiddenCount\) more in Sessions"\)/);

  assert.match(
    scannerViewSwiftSource,
    /CaptureModeCapturesSection\(\s*mode: mode,\s*results: matchingResults,\s*onResend: resend,\s*onDelete: delete\s*\)/
  );
  assert.match(scannerViewSwiftSource, /private func resend\(_ result: ScanResult\)[\s\S]*insertResultIntoComputer\(id: result\.id\)/);
  assert.match(scannerViewSwiftSource, /private func delete\(_ result: ScanResult\) \{\s*store\.removeResult\(id: result\.id\)/);
});

test("native capture session exposes the optional cloud cursor target", () => {
  assert.match(scannerViewSwiftSource, /CloudTargetButton/);
  assert.match(scannerViewSwiftSource, /CloudTargetPickerSheet/);
  assert.match(cloudTargetPickerSwiftSource, /"This iPhone"/);
  assert.match(cloudTargetPickerSwiftSource, /availableComputers/);
  assert.match(captureSessionViewSwiftSource, /CloudTargetButton/);
  // Computer availability now streams continuously over a live Convex subscription
  // (CloudWorkspaceStore.startComputersSubscriptionIfNeeded), so the view no longer
  // needs to trigger a manual refresh on appear.
});

test("App Clip keeps transient WebRTC disconnects alive through background grace", () => {
  assert.match(clipRootViewSwiftSource, /ClipWebRTCBridgeView\(webView: store\.bridgeWebView\)/);
  assert.match(clipRootViewSwiftSource, /store\.updateAppIsInBackground\(newValue != \.active\)/);
  assert.match(clipTransportSwiftSource, /setAppIsInBackground\(\\\(isInBackground\)\)/);
  assert.match(clipWebRTCBridgeSource, /let disconnectGraceMs = 12000/);
  assert.match(clipWebRTCBridgeSource, /setAppIsInBackground\(nextIsInBackground\)/);
  assert.match(clipWebRTCBridgeSource, /if \(!pc \|\| pc\.connectionState !== "disconnected" \|\| isAppInBackground \|\| disconnectTimer\) return/);
  assert.match(clipWebRTCBridgeSource, /pc && pc\.connectionState === "disconnected"[\s\S]*window\.voltBridge\.close\(\)/);
});

test("app clip capture sessions keep one photo batch per presented camera session", () => {
  assert.match(clipRootViewSwiftSource, /@State private var captureSessionBatchId: String\?/);
  assert.match(clipRootViewSwiftSource, /captureSessionBatchId = store\.beginCaptureSession\(\)/);
  assert.match(clipRootViewSwiftSource, /store\.endCaptureSession\(id: captureSessionBatchId\)/);
  assert.match(clipRootViewSwiftSource, /captureBatchId: captureSessionBatchId/);
  assert.match(clipRootViewSwiftSource, /await store\.capturePhoto\(image, batchId: batchId\)/);
  assert.match(clipScannerStoreSwiftSource, /func beginCaptureSession\(\) -> String/);
  assert.match(clipScannerStoreSwiftSource, /let batchId = ScannerProtocol\.makeMessageId\("batch"\)/);
  assert.match(clipScannerStoreSwiftSource, /func endCaptureSession\(id: String\? = nil\)/);
  assert.match(clipScannerStoreSwiftSource, /if let id, activeCaptureBatchId != id \{\s*return\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /func capturePhoto\(_ image: UIImage, batchId: String\? = nil\) async/);
  assert.match(clipScannerStoreSwiftSource, /batchId: batchId \?\? currentCaptureBatchId\(\)/);
});

test("native and app clip can reopen photo capture into a selected batch", () => {
  assert.match(scannerStoreSwiftSource, /var resumedPhotoBatchId: String\?/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func resumePhotoBatch\(id: String\) \{\s*resumedPhotoBatchId = id\s*\}/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func endResumedPhotoBatch\(\) \{\s*resumedPhotoBatchId = nil\s*\}/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func currentPhotoBatch\(now: Date\) -> String \{\s*if let resumedPhotoBatchId \{\s*return resumedPhotoBatchId\s*\}/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func captureSquarePhoto\(\) async \{\s*let batchId = resumedPhotoBatchId[\s\S]*sendPhoto\(preparedImage, result: photoResult, batchId: batchId\)/);
  assert.match(sessionsViewSwiftSource, /private var capturePhotoBatches: \[CapturePhotoBatch\]/);
  assert.match(sessionsViewSwiftSource, /Label\("Continue", systemImage: "plus\.viewfinder"\)/);
  assert.match(sessionsViewSwiftSource, /accessibilityLabel\("Continue \\\(batch\.title\) from/);
  assert.match(sessionsViewSwiftSource, /store\.activeMode = \.photo[\s\S]*store\.resumePhotoBatch\(id: batch\.id\)\s*isCaptureSessionPresented = true/);
  assert.match(sessionsViewSwiftSource, /onDismiss: store\.endResumedPhotoBatch/);
  assert.match(scannerViewSwiftSource, /private func startCapture\(\) \{[\s\S]*store\.endResumedPhotoBatch\(\)/);
  assert.match(captureSessionViewSwiftSource, /\.onAppear \{\s*store\.activeMode = mode/);
  assert.doesNotMatch(captureSessionViewSwiftSource, /\.onAppear \{\s*store\.activeMode = \.ocr/);

  assert.match(clipScannerStoreSwiftSource, /func resumeCaptureSession\(batchId: String\) -> String \{\s*activeCaptureBatchId = batchId\s*return batchId\s*\}/);
  assert.match(clipRootViewSwiftSource, /Label\("Add Photos", systemImage: "plus\.viewfinder"\)/);
  assert.match(clipRootViewSwiftSource, /store\.activeCaptureMode = \.photo\s*captureSessionBatchId = store\.resumeCaptureSession\(batchId: batch\.id\)\s*isCaptureSessionPresented = true/);
  assert.match(clipRootViewSwiftSource, /let batchId = captureBatchId[\s\S]*onCaptureImage\(image, mode, batchId\)/);
  assert.match(clipRootViewSwiftSource, /store\.activeCaptureMode = \.ocr\s*captureSessionBatchId = store\.beginCaptureSession\(\)/);
  assert.doesNotMatch(clipRootViewSwiftSource, /\.onAppear \{\s*activeMode = \.ocr/);
});

test("native photo viewfinder sits below the status bar and the floating cloud target button", () => {
  assert.match(scannerCameraLayerSwiftSource, /private let photoTopClearance: CGFloat = 62/);
  assert.doesNotMatch(scannerCameraLayerSwiftSource, /photoControlsReservedHeight/);
  assert.match(
    scannerCameraLayerSwiftSource,
    /private func photoPreviewLayout\(in proxy: GeometryProxy\) -> \(side: CGFloat, topOffset: CGFloat\) \{\s*let availableHeight = max\(0, proxy\.size\.height - photoTopClearance\)/
  );
  assert.doesNotMatch(scannerCameraLayerSwiftSource, /proxy\.safeAreaInsets/);
  // Photo mode alone respects the safe area; text and barcode keep their full-bleed preview.
  assert.match(
    captureSessionViewSwiftSource,
    /ScannerCameraLayer\(gridVisible: gridVisible\)\s*\.ignoresSafeArea\(edges: store\.activeMode == \.photo \? \[\] : \.all\)/
  );
  assert.match(captureSessionViewSwiftSource, /\.background\(Color\.black\.ignoresSafeArea\(\)\)/);
  assert.match(scannerCameraLayerSwiftSource, /cameraPreview\s*\.ignoresSafeArea\(\)/);
});

test("native photo sessions stack captured shots in the bottom-left of the controls", () => {
  assert.match(scannerStoreSwiftSource, /static let sessionPhotoStripLimit = 3/);
  assert.match(scannerStoreSwiftSource, /var sessionPhotoThumbnails: \[SessionPhotoThumbnail\] = \[\]/);
  assert.match(scannerStoreSwiftSource, /var sessionPhotoCount = 0/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /appendSessionPhotoThumbnail\(preparedImage\)\s*await sendPhoto\(/);
  assert.match(
    scannerStoreCaptureActionsSwiftSource,
    /func startSessionPhotoStrip\(\) \{\s*guard let resumedPhotoBatchId else \{\s*sessionPhotoThumbnails = \[\]\s*sessionPhotoCount = 0/
  );
  assert.match(
    scannerStoreCaptureActionsSwiftSource,
    /func appendSessionPhotoThumbnail\(_ image: UIImage\) \{\s*sessionPhotoCount \+= 1/
  );
  assert.match(captureSessionViewSwiftSource, /store\.activeMode = mode\s*store\.startSessionPhotoStrip\(\)/);
  assert.match(
    captureSessionViewSwiftSource,
    /capturedThumbnails: store\.activeMode == \.photo \? store\.sessionPhotoThumbnails : \[\],\s*capturedCount: store\.sessionPhotoCount/
  );
  assert.match(sharedCameraSessionControlsSwiftSource, /struct CapturedPhotoStrip: View/);
  assert.match(sharedCameraSessionControlsSwiftSource, /private var leadingSlot: some View \{[\s\S]*CapturedPhotoStrip\(/);
});

test("native photo capture follows the phone sideways without unlocking portrait", () => {
  assert.match(cameraModelSwiftSource, /enum CaptureOrientation: String, CaseIterable/);
  assert.match(cameraModelSwiftSource, /init\?\(deviceOrientation: UIDeviceOrientation\)/);
  assert.match(
    cameraModelSwiftSource,
    /var controlRotationDegrees: Double \{\s*switch self \{\s*case \.portrait:\s*0\s*case \.portraitUpsideDown:\s*180\s*case \.landscapeLeft:\s*90\s*case \.landscapeRight:\s*-90/
  );
  assert.match(
    cameraModelSwiftSource,
    /var videoRotationAngle: CGFloat \{\s*switch self \{\s*case \.portrait:\s*90\s*case \.portraitUpsideDown:\s*270\s*case \.landscapeLeft:\s*0\s*case \.landscapeRight:\s*180/
  );
  assert.match(cameraModelSwiftSource, /func capturePhoto\(matchingDeviceOrientation: Bool = false\) async -> UIImage\?/);
  assert.match(
    cameraModelSwiftSource,
    /applyCaptureRotationAngle\(matchingDeviceOrientation \? captureOrientation : \.portrait\)/
  );
  assert.match(cameraModelSwiftSource, /guard connection\.isVideoRotationAngleSupported\(angle\) else \{ return \}/);
  // Text and barcode crops are measured against the portrait preview, so only photos re-tag.
  assert.match(scannerStoreCaptureActionsSwiftSource, /camera\.capturePhoto\(matchingDeviceOrientation: true\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /guard let image = await camera\.capturePhoto\(\) else \{ return \}/);
  assert.match(cameraModelSwiftSource, /func start\(\) \{[\s\S]*startObservingDeviceOrientation\(\)/);
  assert.match(cameraModelSwiftSource, /func stop\(\) \{\s*stopObservingDeviceOrientation\(\)/);
  assert.match(captureSessionViewSwiftSource, /controlRotation: \.degrees\(store\.camera\.captureOrientation\.controlRotationDegrees\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /var controlRotation: Angle = \.zero/);
  assert.match(sharedCameraSessionControlsSwiftSource, /var rotation: Angle = \.zero/);
});

test("app clip photo mode viewfinder stays edge-to-edge while capture status changes", () => {
  assert.match(clipRootViewSwiftSource, /if activeMode == \.photo, ocrReviewImage == nil \{[\s\S]*GeometryReader/);
  assert.match(clipRootViewSwiftSource, /let side = previewGeometry\.size\.width/);
  assert.doesNotMatch(clipRootViewSwiftSource, /let side = min\(previewGeometry\.size\.width, previewGeometry\.size\.height\)/);
  assert.match(clipRootViewSwiftSource, /\.frame\(maxWidth: \.infinity, maxHeight: \.infinity, alignment: \.top\)/);
});

test("app clip dictation attaches the microphone to Chrome's offered audio sender before starting", () => {
  assert.match(clipWebRTCBridgeSource, /const offeredAudio = pc\.getTransceivers\(\)\.find/);
  assert.match(clipWebRTCBridgeSource, /transceiver\.direction = "sendonly"/);
  assert.match(clipWebRTCBridgeSource, /audioSender = transceiver\.sender/);
  assert.match(clipWebRTCBridgeSource, /if \(!audioSender\) \{\s*configureAudioSender\(\);\s*\}/);
  assert.match(clipWebRTCBridgeSource, /if \(audioSender && audioSender\.track !== track\) \{\s*await audioSender\.replaceTrack\(track\);\s*\}/);
  const replaceTrackStart = clipWebRTCBridgeSource.indexOf("await audioSender.replaceTrack(track);");
  const startedMessageStart = clipWebRTCBridgeSource.indexOf('phase: "started"', replaceTrackStart);
  assert.ok(replaceTrackStart > -1);
  assert.ok(startedMessageStart > replaceTrackStart);
});

test("installed app removes pairing headers while App Clip keeps connection controls", () => {
  assert.doesNotMatch(rootViewSwiftSource, /ScannerSectionHeader|ScannerConnectionSummary|PairingStatusSheet/);
  assert.doesNotMatch(scannerViewSwiftSource, /PairingSessionsView|isSessionsPresented|onConnectionControlTapped/);
  assert.doesNotMatch(uploadViewSwiftSource, /PairingSessionsView|isSessionsPresented|onConnectionControlTapped/);
  assert.match(scannerViewSwiftSource, /CloudTargetButton/);
  assert.match(clipRootViewSwiftSource, /private func clipConnectionTitle\(/);
  assert.match(clipRootViewSwiftSource, /if isPairing \{\s*return "Connecting"\s*\}/);
  assert.match(clipRootViewSwiftSource, /private struct ClipPairingFailureView: View/);
  assert.match(clipRootViewSwiftSource, /Label\("Scan QR Code", systemImage: "qrcode\.viewfinder"\)/);
  assert.doesNotMatch(clipRootViewSwiftSource, /private struct ClipPairingSessionsView: View/);
});

test("native first launch opens capture without pairing or requesting camera early", () => {
  assert.doesNotMatch(rootViewSwiftSource, /Pairing|Reconnect|connectionStatus|updateAppIsInBackground/);
  assert.match(rootViewSwiftSource, /store\.cloudWorkspace\.requestSync\(\)/);
  assert.doesNotMatch(rootViewSwiftSource, /store\.camera\.requestAccess\(\)/);
  assert.match(captureSessionViewSwiftSource, /\.task \{\s*await store\.camera\.requestAccess\(\)\s*syncCameraForOcrReview/);
  assert.match(sharedPairingSessionComponentsSwiftSource, /private let webScannerURLText = "volt\.juanquenga\.com\/clip"/);
  assert.match(sharedPairingSessionComponentsSwiftSource, /Text\("Scan the QR code from the Chrome extension, or open the App Clip page on your computer\. This iPhone will connect to that browser session\."\)/);
});

test("app clip uses the same app icon resource as the main app", () => {
  assert.match(xcodeProjectSource, /B0000000000000000000001B \/\* volt\.icon in Resources \*\//);
  assert.match(xcodeProjectSource, /B3000000000000000000001E \/\* volt\.icon in Resources \*\//);
  assert.match(xcodeProjectSource, /H30000000000000000000001 \/\* Resources \*\/ = \{[\s\S]*B3000000000000000000001E \/\* volt\.icon in Resources \*\//);
  const clipConfigStart = xcodeProjectSource.indexOf("J30000000000000000000001 /* Debug */");
  const clipConfigSource = xcodeProjectSource.slice(clipConfigStart, xcodeProjectSource.indexOf("J400", clipConfigStart) === -1 ? undefined : xcodeProjectSource.indexOf("J400", clipConfigStart));
  assert.ok(clipConfigStart > -1);
  assert.match(clipConfigSource, /ASSETCATALOG_COMPILER_APPICON_NAME = volt/g);
  assert.doesNotMatch(clipConfigSource, /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon/);
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
  assert.match(scannerRecognitionModelsSwiftSource, /struct TextQuadrilateral: Equatable/);
  assert.match(scannerRecognitionModelsSwiftSource, /init\(observation: VNRectangleObservation\)/);
  assert.match(textRecognizerSwiftSource, /quadrilateral: TextQuadrilateral\(observation: observation\)/);
  assert.match(ocrReviewLayerSwiftSource, /OcrRegionShape\(points: points\)/);
  assert.match(ocrReviewLayerSwiftSource, /viewPoints\(for: region\.quadrilateral/);
});

test("native OCR review keeps raw Vision text until selected cleanup is requested", () => {
  assert.match(ocrTextCleanerSwiftSource, /import FoundationModels/);
  assert.match(ocrTextCleanerSwiftSource, /enum OcrTextCleaner/);
  assert.match(ocrTextCleanerSwiftSource, /static func clean\(text: String\) async -> OcrTextCleanupResult/);
  assert.match(ocrTextCleanerSwiftSource, /SystemLanguageModel\(/);
  assert.match(ocrTextCleanerSwiftSource, /LanguageModelSession\(/);
  assert.match(ocrTextCleanerSwiftSource, /if let match = LiveTextIdentifierMatcher\.match\(normalized\) \{\s*return match\.value\s*\}/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /let recognizedRegions = try await TextRecognizer\.recognizeTextRegions\(in: preparedImage\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /ocrTextRegions = DeviceIdentifierRegionExtractor\.reviewRegions\(from: recognizedRegions\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /ocrReviewText = ocrTextRegions\.map\(\\\.text\)\.joined\(separator: "\\n"\)/);
  assert.doesNotMatch(scannerStoreCaptureActionsSwiftSource, /OcrTextCleaner\.clean/);
});

test("native camera can detect identifier candidates before OCR capture", () => {
  assert.match(cameraModelSwiftSource, /private let videoOutput = AVCaptureVideoDataOutput\(\)/);
  assert.match(cameraModelSwiftSource, /private let liveTextFrameProcessor = LiveTextFrameProcessor\(\)/);
  assert.match(cameraModelSwiftSource, /videoOutput\.alwaysDiscardsLateVideoFrames = true/);
  assert.match(cameraModelSwiftSource, /videoOutput\.setSampleBufferDelegate\(liveTextFrameProcessor, queue: videoQueue\)/);
  assert.match(cameraModelSwiftSource, /VNRecognizeTextRequest/);
  assert.match(cameraModelSwiftSource, /request\.recognitionLevel = \.accurate/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /request\.recognitionLevel = \.accurate/);
  assert.match(cameraModelSwiftSource, /"Wireless Controller"/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /"Wireless Controller"/);
  assert.match(cameraModelSwiftSource, /private let recognitionInterval: Duration = \.milliseconds\(500\)/);
  assert.match(cameraModelSwiftSource, /let candidates = Self\.candidates\(from: observations\)/);
  assert.match(cameraModelSwiftSource, /try\? text\.boundingBox\(for: match\.range\)/);
  assert.doesNotMatch(cameraModelSwiftSource, /layerRectConverted\(fromMetadataOutputRect:/);
});

test("native pre-capture identifier matching is deterministic", () => {
  assert.match(scannerRecognitionModelsSwiftSource, /enum LiveTextCandidateKind: String, Equatable/);
  assert.match(scannerRecognitionModelsSwiftSource, /case imei = "IMEI"/);
  assert.match(scannerRecognitionModelsSwiftSource, /case model = "Model"/);
  assert.match(scannerRecognitionModelsSwiftSource, /case serial = "Serial"/);
  assert.match(scannerRecognitionModelsSwiftSource, /case sku = "SKU"/);
  assert.match(scannerRecognitionModelsSwiftSource, /enum LiveTextIdentifierMatcher/);
  assert.match(scannerRecognitionModelsSwiftSource, /struct Match \{[\s\S]*let range: Range<String\.Index>/);
  assert.match(scannerRecognitionModelsSwiftSource, /guard text\.localizedCaseInsensitiveContains\("imei"\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /guard isValidLuhn\(candidate\) else \{ continue \}/);
  assert.match(scannerRecognitionModelsSwiftSource, /serialLabels = \["serial number", "serial no", "serial", "s\/n", "s\/ n", "s n", "s\. n\.", "sn"\]/);
  assert.match(scannerRecognitionModelsSwiftSource, /modelLabels = \["model number", "model no", "model", "mdl"\]/);
  assert.match(scannerRecognitionModelsSwiftSource, /skuLabels = \["sku", "stock keeping unit"\]/);
  assert.match(scannerRecognitionModelsSwiftSource, /private static func standaloneIdentifier\(in text: String\) -> Match\?/);
  assert.match(scannerRecognitionModelsSwiftSource, /private static func modelTokenCandidate\(in text: String\) -> \(value: String, range: Range<String\.Index>\)\?/);
  assert.match(scannerRecognitionModelsSwiftSource, /combinedModelToken\(prefix: candidate\.value, suffix: next\.value\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /uppercased\.hasPrefix\("CF1"\) \|\| uppercased\.hasPrefix\("CFL"\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /uppercased\.hasPrefix\("CFI"\) && !uppercased\.hasPrefix\("CFI-"\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /isKnownModelToken\(\$0\.value\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /isLikelySerialToken\(\$0\.value\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /static func labelKind\(in rawText: String\) -> LiveTextCandidateKind\?/);
  assert.match(scannerRecognitionModelsSwiftSource, /static func standaloneValue\(in rawText: String, kind: LiveTextCandidateKind\) -> String\?/);
  assert.match(scannerRecognitionModelsSwiftSource, /private static func labelRange\(in text: String, label: String\) -> Range<String\.Index>\?/);
  assert.match(scannerRecognitionModelsSwiftSource, /isLabelBoundary\(in: text, before: range\.lowerBound\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /isLabelBoundary\(in: text, after: range\.upperBound\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /text\[valueStart\.\.\.\]\.range\(of: cleaned\)/);
});

test("native pre-capture identifiers render as a stable controls readout", () => {
  assert.match(scannerCameraLayerSwiftSource, /store\.camera\.setLiveTextScanningEnabled\(store\.activeMode == \.ocr\)/);
  assert.match(scannerCameraLayerSwiftSource, /\.onDisappear \{\s*store\.camera\.setLiveTextScanningEnabled\(false\)\s*\}/);
  assert.doesNotMatch(scannerCameraLayerSwiftSource, /LiveTextCandidateReticle/);
  assert.match(captureSessionViewSwiftSource, /LiveIdentifierStrip\([\s\S]*candidates: store\.camera\.liveTextCandidates,[\s\S]*store\.sendRecognizedText\(candidate\.value\)/);
  assert.match(captureSessionViewSwiftSource, /hasLiveTextCandidates: !store\.camera\.liveTextCandidates\.isEmpty/);
  assert.doesNotMatch(sharedCameraSessionControlsSwiftSource, /let liveTextCandidates: \[LiveTextCandidate\]/);
  assert.match(sharedCameraSessionControlsSwiftSource, /let hasLiveTextCandidates: Bool/);
  assert.match(cameraSessionControlsSwiftSource, /struct LiveIdentifierStrip: View/);
  assert.match(cameraSessionControlsSwiftSource, /let onSend: \(LiveTextCandidate\) -> Void/);
  assert.match(cameraSessionControlsSwiftSource, /struct LiveIdentifierChip: View/);
  assert.match(sharedCameraSessionControlsSwiftSource, /"Frame device identifiers"/);
  assert.match(sharedCameraSessionControlsSwiftSource, /"Tap a recognized chip to send"/);
  assert.match(cameraSessionControlsSwiftSource, /Button\(action: onSend\)/);
  assert.match(cameraSessionControlsSwiftSource, /\.background\(Color\.green, in: Capsule\(\)\)/);
});

test("native pre-capture identifier chips show quickly and correct repeated replacements", () => {
  assert.match(cameraModelSwiftSource, /private var liveTextReplacementObservationCounts: \[String: Int\] = \[:\]/);
  assert.match(cameraModelSwiftSource, /private var liveTextEmptyObservationCount = 0/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /private var liveTextEmptyObservationCount = 0/);
  assert.match(cameraModelSwiftSource, /var acceptedCandidates = liveTextCandidates/);
  assert.match(cameraModelSwiftSource, /hasLiveTextCandidate\(candidate, in: acceptedCandidates\)/);
  assert.match(cameraModelSwiftSource, /replacementIndex\(for: candidate, in: acceptedCandidates\)/);
  assert.match(cameraModelSwiftSource, /shouldReplaceLiveTextCandidate\(candidate, replacing: acceptedCandidates\[replacementIndex\]\)/);
  assert.match(cameraModelSwiftSource, /case \.imei:\s*return existingKindCount < 2/);
  assert.match(cameraModelSwiftSource, /case \.model, \.serial, \.sku:\s*return existingKindCount < 1/);
  assert.match(cameraModelSwiftSource, /guard !candidates\.isEmpty else \{\s*liveTextEmptyObservationCount \+= 1\s*if liveTextEmptyObservationCount >= 3/);
  assert.match(cameraModelSwiftSource, /liveTextEmptyObservationCount = 0\s*var acceptedCandidates = liveTextCandidates/);
  assert.match(cameraModelSwiftSource, /request\.minimumTextHeight = 0\.006/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /request\.minimumTextHeight = 0\.006/);
  assert.match(cameraModelSwiftSource, /"CFI-ZCT1W"/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /"CFI-ZCT1W"/);
  assert.match(scannerRecognitionModelsSwiftSource, /enum LiveTextCandidateObservationExtractor/);
  assert.match(scannerRecognitionModelsSwiftSource, /labelAnchoredRowCandidates\(in: snapshots\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /denseRowCandidates\(in: snapshots\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /isSameTextRow\(/);
  assert.match(scannerRecognitionModelsSwiftSource, /max\(0\.035, heightTolerance\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /let combinedText = rowWindow\.map\(\\\.text\)\.joined\(separator: " "\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /LiveTextIdentifierMatcher\.match\(combinedText, allowingStandalone: false\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /unionBoundingBox\(for: rowWindow\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /adjacentLabelValueCandidates\(in: snapshots\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /LiveTextIdentifierMatcher\.labelKind\(in: label\.text\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /LiveTextIdentifierMatcher\.standaloneValue\(in: value\.text, kind: kind\)/);
  assert.match(cameraModelSwiftSource, /LiveTextCandidateObservationExtractor\.prioritizedCandidates/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /LiveTextCandidateObservationExtractor\.prioritizedCandidates/);
  assert.match(cameraModelSwiftSource, /guard observationCount >= 2 else \{ return false \}/);
  assert.match(cameraModelSwiftSource, /observationCount >= 3/);
});

test("native post-capture OCR extracts device identifiers from recognized rows", () => {
  assert.match(scannerRecognitionModelsSwiftSource, /enum DeviceIdentifierRegionExtractor/);
  assert.match(scannerRecognitionModelsSwiftSource, /regions\.filter\(\\\.isDeviceIdentifier\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /identifierRegion\(from: \$0, allowingStandalone: false\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /identifierRegion\(from: \$0, allowingStandalone: true\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /LiveTextIdentifierMatcher\.match\(region\.text, allowingStandalone: allowingStandalone\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /text: match\.value/);
  assert.match(textRecognizerSwiftSource, /if let match = LiveTextIdentifierMatcher\.match\(trimmed\)/);
  assert.match(textRecognizerSwiftSource, /let matchedGlyphs = Self\.glyphs\(in: match\.range, text: trimmed, glyphs: glyphs\)/);
  assert.match(textRecognizerSwiftSource, /appendGlyphRegion\([\s\S]*text: match\.value[\s\S]*isDeviceIdentifier: true/);
  assert.match(scannerRecognitionModelsSwiftSource, /let isDeviceIdentifier: Bool/);
  assert.match(ocrReviewLayerSwiftSource, /region\.isDeviceIdentifier \? \.green\.opacity\(0\.24\) : \.yellow\.opacity\(0\.24\)/);
  assert.match(ocrReviewLayerSwiftSource, /region\.isDeviceIdentifier \? \.green\.opacity\(0\.9\) : \.yellow\.opacity\(0\.9\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /return identifierRegions\.isEmpty \? regions : deduplicated\(identifierRegions\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /static func reviewRegions\(from regions: \[RecognizedTextRegion\]\) -> \[RecognizedTextRegion\]/);
  assert.match(scannerRecognitionModelsSwiftSource, /guard !containsEquivalentText\(region, in: reviewRegions\) else \{ continue \}/);
  assert.match(ocrReviewLayerSwiftSource, /Button\("Copy", systemImage: "doc\.on\.doc"\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /private static let regulatoryLabels = \[/);
  assert.match(scannerRecognitionModelsSwiftSource, /"cnc id"/);
  assert.match(scannerRecognitionModelsSwiftSource, /"conatel"/);
  assert.match(scannerRecognitionModelsSwiftSource, /"anatel"/);
  assert.match(scannerRecognitionModelsSwiftSource, /guard !isRegulatoryIdentifierContext\(text\) else \{ return nil \}/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /DeviceIdentifierRegionExtractor\.reviewRegions\(from: recognizedRegions\)/);
});

test("native OCR target dialog can clean selected text before sending", () => {
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /Button\(action: onSend\) \{[\s\S]*Label\("Send", systemImage: "paperplane\.fill"\)/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /Button\(action: onCleanup\) \{[\s\S]*Label\(isCleaning \? "Cleaning\.\.\." : "Cleanup", systemImage: "wand\.and\.sparkles"\)/);
  assert.match(captureSessionViewSwiftSource, /store\.sendRecognizedText\(selectedCleanedText \?\? selectedTextRegion\.text\)/);
  assert.match(captureSessionViewSwiftSource, /onDismiss: \{\s*selectedTextRegion = nil\s*selectedCleanedText = nil\s*\}/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /Button\(action: onDismiss\) \{[\s\S]*Image\(systemName: "xmark"\)/);
  assert.match(captureSessionViewSwiftSource, /let result = await OcrTextCleaner\.clean\(text: region\.text\)/);
  assert.match(captureSessionViewSwiftSource, /private var selectedTextPreview: String/);
});

test("native scanner normalizes UPC-A barcodes and preserves upload selection order", () => {
  assert.match(scannerStoreCaptureActionsSwiftSource, /normalizedBarcodeScan\(value: value, format: camera\.lastBarcodeFormat \?\? "barcode"\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /trimmedValue\.count == 13/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /trimmedValue\.first == "0"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /return \(String\(trimmedValue\.dropFirst\(\)\), "upc_a"\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /let capturedAt = now\.addingTimeInterval\(Double\(index\) \/ 1000\)/);
  assert.ok(scannerStoreCaptureActionsSwiftSource.includes('value: "Upload \\(index + 1)"'));
});

test("native upload batches expose clear progress while photos are preparing and uploading", () => {
  assert.match(sharedScannerTabComponentsSwiftSource, /struct PhotoUploadProgress: Identifiable, Equatable/);
  assert.match(scannerStoreSwiftSource, /var photoUploadProgress: PhotoUploadProgress\?/);
  assert.match(sharedScannerTabComponentsSwiftSource, /var remainingCount: Int/);
  assert.match(sharedScannerTabComponentsSwiftSource, /"Uploading \\\(min\(finishedCount \+ 1, total\)\) of \\\(total\)"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /photoUploadProgress = PhotoUploadProgress\(/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /updatePhotoUploadProgress\(batchId: batch, prepared: index \+ 1, phase: \.uploading\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /finishPhotoUploadItem\(batchId: batch, resultId: photoResult\.id\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /finishPhotoUploadBatch\(batchId: batch\)/);
  assert.match(uploadViewSwiftSource, /PhotoPreparationProgressSummary\(\s*prepared: selectedUploadPrepared,\s*total: selectedUploadTotal\s*\)/);
  assert.match(uploadViewSwiftSource, /PhotoUploadProgressSummary\(progress: progress\)/);
  assert.match(sharedScannerTabComponentsSwiftSource, /ProgressView\(value: progress\.fractionCompleted\)/);
  assert.match(uploadViewSwiftSource, /"Reading \\\(selectedUploadReadCount\) of \\\(selectedUploadTotal\) selected photos"/);
  assert.match(sharedScannerTabComponentsSwiftSource, /struct PhotoPreparationProgressSummary: View/);
  assert.match(sharedScannerTabComponentsSwiftSource, /struct PhotoUploadProgressSummary: View/);
  assert.match(uploadViewSwiftSource, /GeometryReader \{ proxy in/);
  assert.match(uploadViewSwiftSource, /\.frame\(width: proxy\.size\.width, height: proxy\.size\.height\)/);
  assert.match(uploadViewSwiftSource, /"\\\(progress\.title\)\. \\\(progress\.detail\)\."/);
  assert.match(uploadViewSwiftSource, /"Uploading \\\(results\.count\) of \\\(expectedTotal\) photo/);
  assert.match(readFileSync(new URL("../ios/Volt/Views/SharedScannerTabComponents.swift", import.meta.url), "utf8"), /var isUploading = false/);
});

test("native upload picker accepts and queues more photos while a batch is active", () => {
  assert.match(uploadViewSwiftSource, /@State private var queuedUploadSelections: \[\[PhotosPickerItem\]\] = \[\]/);
  assert.match(uploadViewSwiftSource, /private func enqueueUploadSelection\(_ items: \[PhotosPickerItem\]\)/);
  assert.match(uploadViewSwiftSource, /while !queuedUploadSelections\.isEmpty/);
  assert.doesNotMatch(uploadViewSwiftSource, /guard store\.connectionStatus\.isConnected/);
  assert.doesNotMatch(uploadViewSwiftSource, /\.onChange\(of: store\.connectionStatus\)/);
  assert.match(uploadViewSwiftSource, /selectedItems = \[\][\s\S]*enqueueUploadSelection\(newItems\)/);
  assert.match(uploadViewSwiftSource, /else if let progress = activeUploadProgress/);
  assert.doesNotMatch(uploadViewSwiftSource, /defer \{[\s\S]*isPreparingUploads = false/);
  assert.match(sharedScannerTabComponentsSwiftSource, /let isPickerEnabled = isConnected/);
  assert.match(sharedScannerTabComponentsSwiftSource, /return "Add More Photos"/);
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
  assert.match(rootViewSwiftSource, /SettingsView\(showsAccountSettings: showsAccountSettings\)\s*\.tabItem \{ Label\("Settings", systemImage: "gearshape"\) \}/);
  assert.match(settingsViewSwiftSource, /Picker\("Recognized Codes", selection: \$store\.barcodeRecognitionMode\)/);
  assert.match(settingsViewSwiftSource, /ForEach\(BarcodeRecognitionMode\.allCases\)/);
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
  assert.match(scannerCameraLayerSwiftSource, /store\.camera\.updateBarcodeGuideRect\(nil\)/);
  assert.match(scannerCameraLayerSwiftSource, /if guideVisible,\s*store\.activeMode == \.barcode,\s*let barcodeBounds = store\.camera\.detectedBarcodeBounds/);
});

test("native camera resets capture sessions to display 1x zoom", () => {
  const startSource = cameraModelSwiftSource.slice(
    cameraModelSwiftSource.indexOf("func start()"),
    cameraModelSwiftSource.indexOf("func stop()")
  );

  assert.match(startSource, /resetZoomToDisplayOne\(for: videoDevice\)/);
  assert.match(cameraZoomControllerSwiftSource, /enum CameraZoomController/);
  assert.match(cameraZoomControllerSwiftSource, /static func rawZoomFactorForDisplayOne\(on device: AVCaptureDevice\) -> CGFloat/);
  assert.match(cameraZoomControllerSwiftSource, /static func resetToDisplayOne\(on device: AVCaptureDevice\) throws -> CameraZoomState/);
  assert.match(cameraModelSwiftSource, /nonisolated private func resetZoomToDisplayOne\(for device: AVCaptureDevice\)/);
  assert.match(cameraModelSwiftSource, /CameraZoomController\.resetToDisplayOne\(on: device\)/);
  assert.match(cameraZoomControllerSwiftSource, /device\.videoZoomFactor = clampedFactor/);
  assert.match(cameraModelSwiftSource, /applyZoomState\(state\)/);
});

test("native camera uses system virtual lens switching with single tap focus", () => {
  assert.match(cameraDeviceSelectorSwiftSource, /configureNativeVirtualDeviceSwitching\(on device: AVCaptureDevice\)/);
  assert.match(cameraDeviceSelectorSwiftSource, /applySmoothTapFocus\(on device: AVCaptureDevice, point: CGPoint\)/);
  assert.match(cameraDeviceSelectorSwiftSource, /isSmoothAutoFocusEnabled = true/);
  assert.match(cameraDeviceSelectorSwiftSource, /focusMode = \.autoFocus/);
  assert.match(cameraDeviceSelectorSwiftSource, /exposureMode = \.autoExpose/);
  assert.match(cameraDeviceSelectorSwiftSource, /isSubjectAreaChangeMonitoringEnabled = true/);
  assert.match(cameraDeviceSelectorSwiftSource, /primaryConstituentDeviceSwitchingBehavior != \.unsupported/);
  assert.doesNotMatch(cameraDeviceSelectorSwiftSource, /fallbackPrimaryConstituentDevices = \[\]/);
  assert.match(
    cameraDeviceSelectorSwiftSource,
    /setPrimaryConstituentDeviceSwitchingBehavior\(\s*\.auto,\s*restrictedSwitchingBehaviorConditions: \[\]\s*\)/
  );
  assert.match(cameraModelSwiftSource, /CameraDeviceSelector\.configureNativeVirtualDeviceSwitching\(on: camera\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraDeviceSelector\.configureNativeVirtualDeviceSwitching\(on: camera\)/);
  assert.match(cameraModelSwiftSource, /CameraDeviceSelector\.applySmoothTapFocus\(on: videoDevice, point: point\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraDeviceSelector\.applySmoothTapFocus\(on: videoDevice, point: point\)/);
});

test("native camera shares smooth display zoom for pinch and controls", () => {
  assert.match(cameraZoomControllerSwiftSource, /enum CameraZoomGesturePhase/);
  assert.match(cameraZoomControllerSwiftSource, /private static let zoomRampRate: Float = 4/);
  assert.match(cameraZoomControllerSwiftSource, /private static let gestureZoomSensitivity: CGFloat = 0\.72/);
  assert.match(cameraZoomControllerSwiftSource, /forDisplayZoomDelta delta: CGFloat/);
  assert.match(cameraZoomControllerSwiftSource, /forDisplayZoomScale scale: CGFloat/);
  assert.match(cameraZoomControllerSwiftSource, /adjustedGestureScale\(scale\)/);
  assert.match(cameraZoomControllerSwiftSource, /device\.ramp\(toVideoZoomFactor: clampedFactor, withRate: zoomRampRate\)/);
  assert.match(cameraModelSwiftSource, /setDisplayZoomFactor\(displayZoomFactor \+ delta, ramping: true\)/);
  assert.match(cameraModelSwiftSource, /private var zoomGestureStartDisplayFactor: CGFloat\?/);
  assert.match(cameraModelSwiftSource, /func handleZoomGesture\(scale: CGFloat, phase: CameraZoomGesturePhase\)/);
  assert.match(cameraModelSwiftSource, /currentDisplayZoomFactor: startDisplayZoomFactor/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /forDisplayZoomDelta: delta,[\s\S]*currentDisplayZoomFactor: displayZoomFactor/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /private var zoomGestureStartDisplayFactor: CGFloat\?/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func handleZoomGesture\(scale: CGFloat, phase: CameraZoomGesturePhase\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /currentDisplayZoomFactor: startDisplayZoomFactor/);
  assert.match(cameraModelSwiftSource, /CameraZoomController\.setRawZoomFactor\([\s\S]*ramping: ramping/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraZoomController\.setRawZoomFactor\([\s\S]*ramping: ramping/);
  assert.doesNotMatch(cameraPreviewSwiftSource, /recognizer\.scale = 1/);
});

test("native camera clears stale torch state when capture sessions stop", () => {
  const stopSource = cameraModelSwiftSource.slice(
    cameraModelSwiftSource.indexOf("func stop()"),
    cameraModelSwiftSource.indexOf("func clearDetectedBarcode()")
  );
  const clipStopSource = clipBarcodeScannerServiceSwiftSource.slice(
    clipBarcodeScannerServiceSwiftSource.indexOf("func stop()"),
    clipBarcodeScannerServiceSwiftSource.indexOf("func setLiveTextScanningEnabled")
  );

  assert.match(stopSource, /setTorchEnabled\(false\)/);
  assert.match(cameraModelSwiftSource, /guard let videoDevice, videoDevice\.hasTorch else \{\s*torchEnabled = false\s*return\s*\}/);
  assert.match(clipStopSource, /setTorchEnabled\(false\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /guard let videoDevice, videoDevice\.hasTorch else \{\s*torchEnabled = false\s*onCameraStateChanged\?\(\)\s*return\s*\}/);
});

test("app clip capture controls are wired to camera hardware actions", () => {
  assert.match(clipRootViewSwiftSource, /torchEnabled: cameraService\.torchEnabled/);
  assert.match(clipRootViewSwiftSource, /zoomLabel: cameraService\.zoomDisplayLabel/);
  assert.match(clipRootViewSwiftSource, /cameraService\.setTorchEnabled\(!cameraService\.torchEnabled\)/);
  assert.match(clipRootViewSwiftSource, /onRetake: \{\s*selectedTextRegion = nil\s*selectedCleanedText = nil\s*cameraService\.setTorchEnabled\(false\)\s*onClearOcrReview\(\)/);
  assert.match(clipRootViewSwiftSource, /private func syncCameraForOcrPostCapture\(\) \{[\s\S]*let shouldPauseCamera = activeMode == \.ocr && \(isRecognizingText \|\| ocrReviewImage != nil\)[\s\S]*cameraService\.stop\(\)[\s\S]*cameraService\.start\(\)/);
  assert.match(clipRootViewSwiftSource, /\.onChange\(of: ocrReviewImage != nil\) \{ _, isReviewing in\s*syncCameraForOcrPostCapture\(\)[\s\S]*if isReviewing \{\s*selectedTextRegion = nil\s*selectedCleanedText = nil/);
  assert.match(clipRootViewSwiftSource, /cameraService\.adjustZoom\(by: -0\.25\)/);
  assert.match(clipRootViewSwiftSource, /cameraService\.adjustZoom\(by: 0\.25\)/);
  assert.doesNotMatch(clipRootViewSwiftSource, /onToggleTorch: \{\}/);
  assert.doesNotMatch(clipRootViewSwiftSource, /onZoomOut: \{\}/);
  assert.doesNotMatch(clipRootViewSwiftSource, /onZoomIn: \{\}/);
});

test("app clip camera preview supports tap focus and pinch zoom", () => {
  assert.match(clipRootViewSwiftSource, /UITapGestureRecognizer\(target: self, action: #selector\(handleTap\(_:\)\)\)/);
  assert.match(clipRootViewSwiftSource, /UIPinchGestureRecognizer\(target: self, action: #selector\(handlePinch\(_:\)\)\)/);
  assert.match(clipRootViewSwiftSource, /captureDevicePointConverted\(fromLayerPoint: layerPoint\)/);
  assert.match(clipRootViewSwiftSource, /cameraService\.focus\(at: devicePoint\)/);
  assert.match(clipRootViewSwiftSource, /cameraService\.handleZoomGesture\(scale: scale, phase: phase\)/);
  assert.doesNotMatch(clipRootViewSwiftSource, /recognizer\.scale = 1/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /struct FocusReticle: View/);
  assert.match(clipRootViewSwiftSource, /FocusReticle\(\)/);
});

test("app clip camera service supports zoom, torch, focus, and UPC-A priority", () => {
  assert.match(clipBarcodeScannerServiceSwiftSource, /private\(set\) var torchEnabled = false/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /private\(set\) var zoomDisplayLabel = "1x"/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /session\.sessionPreset = \.photo/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func setTorchEnabled\(_ enabled: Bool\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func adjustZoom\(by delta: CGFloat\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func scaleZoom\(by scale: CGFloat\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func focus\(at point: CGPoint\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /startRunningIfNeeded\(resetZoom: true\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /capturePhoto\(\) async throws -> UIImage \{[\s\S]*await startRunningIfNeeded\(\)/);
  assert.doesNotMatch(clipBarcodeScannerServiceSwiftSource, /capturePhoto\(\) async throws -> UIImage \{[\s\S]*startRunningIfNeeded\(resetZoom: true\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraZoomController\.setRawZoomFactor/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraZoomController\.resetToDisplayOne\(on: device\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /private func upcADigitCount\(_ type: AVMetadataObject\.ObjectType, value: String\) -> Bool/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /if upcADigitCount\(type, value: value\) \{ return 0 \}/);
});

test("app clip OCR target dialog shares cleanup and styling with the main app", () => {
  assert.match(clipRootViewSwiftSource, /ExtractedTextActionCard\(/);
  assert.match(clipRootViewSwiftSource, /text: selectedTextPreview/);
  assert.match(clipRootViewSwiftSource, /isCleaning: isCleaningSelectedText/);
  assert.match(clipRootViewSwiftSource, /let result = await OcrTextCleaner\.clean\(text: region\.text\)/);
  assert.match(clipRootViewSwiftSource, /onSendRecognizedText\(selectedCleanedText \?\? selectedTextRegion\.text\)/);
  assert.match(clipRootViewSwiftSource, /private var selectedTextPreview: String/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /\.foregroundStyle\(\.black\)/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /Color\.white\.opacity\(0\.9\)/);
});

test("app clip capture opens in OCR and keeps capture and upload photo lists separate", () => {
  assert.match(clipScannerStoreSwiftSource, /var activeCaptureMode: CaptureMode = \.ocr/);
  assert.match(clipRootViewSwiftSource, /store\.activeCaptureMode = \.ocr\s*captureSessionBatchId = store\.beginCaptureSession\(\)/);
  assert.match(clipRootViewSwiftSource, /let capturePhotos = store\.photos\.filter \{ \$0\.source == \.capture \}/);
  assert.match(clipRootViewSwiftSource, /ClipCapturePhotoBatchesSection\(/);
  assert.match(clipRootViewSwiftSource, /let uploadPhotos = store\.photos\.filter \{ \$0\.source == \.upload \}/);
  assert.match(clipRootViewSwiftSource, /ClipUploadPhotoBatchesSection\(/);
  assert.match(clipRootViewSwiftSource, /latestPhoto: store\.photos\.first\(where: \{ \$0\.source == \.capture \}\)/);
});

test("app clip captured photos are grouped, previewable, and removable after leaving camera", () => {
  assert.match(clipRootViewSwiftSource, /@State private var expandedBatchIds: Set<String> = \[\]/);
  assert.match(clipRootViewSwiftSource, /@State private var previewedPhoto: ClipScannerStore\.ClipPhoto\?/);
  assert.match(clipRootViewSwiftSource, /let grouped = Dictionary\(grouping: capturePhotos\) \{ photo in\s*photo\.batchId \?\? photo\.id\.uuidString\s*\}/);
  assert.match(clipRootViewSwiftSource, /\.sheet\(item: \$previewedPhoto\)/);
  assert.match(clipRootViewSwiftSource, /private struct ClipCapturePhotoBatchCard: View/);
  assert.match(clipRootViewSwiftSource, /isExpanded \? batch\.photos : Array\(batch\.photos\.suffix\(4\)\)/);
  assert.match(clipRootViewSwiftSource, /accessibilityLabel\("Add photos to \\\(batch\.title\) from/);
  assert.match(clipRootViewSwiftSource, /private struct ClipCapturePhotoThumbnail: View/);
  assert.match(clipRootViewSwiftSource, /private struct ClipPhotoPreviewSheet: View/);
  assert.match(clipRootViewSwiftSource, /store\.removePhoto\(id: photo\.id\)/);
  assert.match(clipRootViewSwiftSource, /store\.removePhotos\(batchId: batch\.id\)/);
  assert.match(clipScannerStoreSwiftSource, /func removePhoto\(id: UUID\)/);
  assert.match(clipScannerStoreSwiftSource, /func removePhotos\(batchId: String\)/);
});

test("app clip photo capture does not move the viewfinder with saved chips or send latest controls", () => {
  assert.match(clipRootViewSwiftSource, /private let photoPreviewToolbarGap: CGFloat = 0/);
  assert.match(clipRootViewSwiftSource, /captureNotice = mode == \.ocr \? "Capturing text image" : nil/);
  assert.match(clipRootViewSwiftSource, /private func successNotice\(for mode: CaptureMode\) -> String\?/);
  assert.match(clipRootViewSwiftSource, /case \.photo, \.dictation:\s*nil/);
  assert.match(clipRootViewSwiftSource, /hasLatestCapture: false/);
  assert.match(clipRootViewSwiftSource, /onSendLatest: nil/);
});

test("app clip bottom CTAs show connection progress while pairing", () => {
  assert.match(sharedScannerTabComponentsSwiftSource, /var isConnecting = false/);
  assert.match(sharedScannerTabComponentsSwiftSource, /isConnecting \? "Connecting\.\.\." : title/);
  assert.match(sharedScannerTabComponentsSwiftSource, /isConnecting \? "hourglass" : systemImage/);
  assert.match(sharedScannerTabComponentsSwiftSource, /if isConnecting \{\s*return "Connecting\.\.\."\s*\}/);
  assert.match(clipRootViewSwiftSource, /ScannerBottomActionAccessory\([\s\S]*isConnecting: store\.isPairing[\s\S]*statusText: captureStatusText/);
  assert.match(clipRootViewSwiftSource, /ScannerPhotoPickerAccessory\([\s\S]*isConnecting: store\.isPairing[\s\S]*statusText: uploadStatusText/);
  assert.match(clipRootViewSwiftSource, /ClipDictationStartAccessory\([\s\S]*isConnecting: store\.isPairing[\s\S]*statusText: dictationStatusText/);
  assert.match(clipRootViewSwiftSource, /private var captureStatusText: String \{\s*if store\.isPairing \{\s*store\.statusText/);
  assert.match(clipRootViewSwiftSource, /private var dictationStatusText: String \{[\s\S]*else if store\.isPairing \{\s*store\.statusText/);
  assert.match(clipRootViewSwiftSource, /private var uploadStatusText: String \{[\s\S]*else if store\.isPairing \{\s*status = store\.statusText/);
  assert.match(clipRootViewSwiftSource, /private var buttonTitle: String \{\s*if isConnecting \{\s*return "Connecting\.\.\."/);
});

test("app clip bottom tab bar orders capture, upload, then dictate", () => {
  const tabViewStart = clipRootViewSwiftSource.indexOf("TabView(selection: $store.selectedTab)");
  const tabViewEnd = clipRootViewSwiftSource.indexOf("ClipWebRTCBridgeView(webView: store.bridgeWebView)", tabViewStart);
  const tabViewSource = clipRootViewSwiftSource.slice(tabViewStart, tabViewEnd);
  const enumStart = clipScannerStoreSwiftSource.indexOf("enum ClipTab");
  const enumEnd = clipScannerStoreSwiftSource.indexOf("var id: String", enumStart);
  const enumSource = clipScannerStoreSwiftSource.slice(enumStart, enumEnd);

  assert.ok(tabViewStart > -1);
  assert.ok(tabViewEnd > tabViewStart);
  assert.ok(
    tabViewSource.indexOf('Label("Capture", systemImage: "camera.viewfinder")') <
      tabViewSource.indexOf('Label("Upload", systemImage: "square.and.arrow.up")')
  );
  assert.ok(
    tabViewSource.indexOf('Label("Upload", systemImage: "square.and.arrow.up")') <
      tabViewSource.indexOf('Label("Dictate", systemImage: "mic")')
  );
  assert.match(enumSource, /case capture\s*case upload\s*case dictate/);
});

test("app clip connect button offers last-session reconnect before scanning QR", () => {
  assert.match(clipScannerStoreSwiftSource, /private struct StoredClipPairingCredential: Codable \{/);
  assert.match(clipScannerStoreSwiftSource, /let signalURL: URL\?/);
  assert.match(xcodeProjectSource, /B30000000000000000000020 \/\* PairingSecretStore\.swift in Sources \*\//);
  assert.match(clipScannerStoreSwiftSource, /private static let lastPairingCredentialStorageKey = "volt\.clip\.lastPairingCredential\.v1"/);
  assert.match(clipScannerStoreSwiftSource, /init\(\) \{\s*loadLastPairingCredential\(\)/);
  assert.match(clipScannerStoreSwiftSource, /private func loadLastPairingCredential\(\) \{[\s\S]*UserDefaults\.standard\.data\(forKey: Self\.lastPairingCredentialStorageKey\)[\s\S]*PairingSecretStore\.secret\(pairingId: storedCredential\.pairingId\)[\s\S]*signalURL: storedCredential\.signalURL/);
  assert.match(clipScannerStoreSwiftSource, /private func persistLastPairingCredential\(\) \{[\s\S]*signalURL: lastPairingCredential\.signalURL[\s\S]*JSONEncoder\.scanner\.encode\(storedCredential\)[\s\S]*UserDefaults\.standard\.set\(data, forKey: Self\.lastPairingCredentialStorageKey\)/);
  assert.match(clipScannerStoreSwiftSource, /var canReconnectToLastSession: Bool \{\s*lastPairingCredential != nil && !isPairing && !isConnected\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /var lastSessionDisplayName: String\? \{\s*lastPairingCredential\?\.displayName\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /func reconnectToLastSession\(\) \{\s*guard !isPairing, !isConnected, let credential = lastPairingCredential else \{ return \}/);
  assert.match(clipRootViewSwiftSource, /@State private var isConnectionSheetPresented = false/);
  assert.match(clipRootViewSwiftSource, /private func handleConnectButtonTapped\(\) \{[\s\S]*if store\.canReconnectToLastSession \|\| store\.pairingFailureMessage != nil \{\s*isConnectionSheetPresented = true\s*\} else \{\s*showPairingScanner\(\)\s*\}/);
  assert.match(clipRootViewSwiftSource, /private struct ClipConnectChoicesView: View/);
  assert.match(clipRootViewSwiftSource, /Text\("Reconnect to \\\(displayName\), or scan a QR code for a different computer session\."\)/);
  assert.match(clipRootViewSwiftSource, /Label\("Reconnect", systemImage: "arrow\.clockwise"\)/);
  assert.match(clipRootViewSwiftSource, /Label\("Scan QR", systemImage: "qrcode\.viewfinder"\)/);
  assert.doesNotMatch(clipRootViewSwiftSource, /onConnectionTapped: \{\s*isPairingScannerPresented = true\s*\}/);
});

test("app clip connected session button opens session actions instead of disconnecting", () => {
  assert.match(clipRootViewSwiftSource, /private func handleConnectButtonTapped\(\) \{\s*if store\.isConnected \{\s*isConnectionSheetPresented = true\s*return\s*\}/);
  assert.doesNotMatch(clipRootViewSwiftSource, /if store\.isConnected \{\s*store\.disconnect\(\)\s*return\s*\}/);
  assert.match(clipRootViewSwiftSource, /let onDisconnect: \(\) -> Void/);
  assert.match(clipRootViewSwiftSource, /if store\.isConnected \{[\s\S]*Text\("Manage the current Chrome session, or scan a QR code to connect to a different computer\."\)/);
  assert.match(clipRootViewSwiftSource, /if store\.isConnected \{[\s\S]*Button\(role: \.destructive\)[\s\S]*Label\("Disconnect", systemImage: "xmark\.circle"\)[\s\S]*minHeight: 62[\s\S]*\.buttonStyle\(\.borderedProminent\)[\s\S]*\.tint\(\.red\)/);
  assert.match(clipRootViewSwiftSource, /onScanQRCode: \{[\s\S]*if store\.isConnected \{\s*store\.disconnect\(\)\s*\}[\s\S]*showPairingScanner\(\)/);
});

test("app clip failure retry prefers saved reconnect over expired qr pairing", () => {
  assert.match(clipScannerStoreSwiftSource, /var canRetryConnection: Bool \{\s*canReconnectToLastSession \|\| canRetryPairing\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /func retryFailedConnection\(\) \{\s*if canReconnectToLastSession \{\s*reconnectToLastSession\(\)\s*\} else \{\s*retryPairing\(\)\s*\}/);
  assert.match(clipRootViewSwiftSource, /Button \{\s*store\.retryFailedConnection\(\)\s*\} label: \{\s*Label\("Retry", systemImage: "arrow\.clockwise"\)/);
  assert.doesNotMatch(clipRootViewSwiftSource, /Button \{\s*store\.retryPairing\(\)\s*\} label: \{\s*Label\("Retry", systemImage: "arrow\.clockwise"\)/);
  assert.match(clipRootViewSwiftSource, /\.disabled\(!store\.canRetryConnection\)/);
});

test("app clip connection sheets use opaque backgrounds and large system actions", () => {
  assert.match(clipRootViewSwiftSource, /\.presentationBackground\(Color\(uiColor: \.systemBackground\)\)/);
  assert.match(clipRootViewSwiftSource, /Label\("Scan QR", systemImage: "qrcode\.viewfinder"\)[\s\S]*minHeight: 62[\s\S]*\.buttonStyle\(\.bordered\)[\s\S]*\.tint\(\.green\)/);
  assert.match(clipRootViewSwiftSource, /Label\("Scan QR", systemImage: "qrcode\.viewfinder"\)[\s\S]*minHeight: 62[\s\S]*\.buttonStyle\(\.borderedProminent\)[\s\S]*\.tint\(\.green\)/);
  assert.match(clipRootViewSwiftSource, /Label\("Scan QR Code", systemImage: "qrcode\.viewfinder"\)[\s\S]*minHeight: 62[\s\S]*\.buttonStyle\(\.bordered\)[\s\S]*\.tint\(\.green\)/);
});

test("app clip connecting sheet can cancel or switch to QR scanning", () => {
  assert.match(clipScannerStoreSwiftSource, /private var activeConnectionAttemptLabel: String\?/);
  assert.match(clipScannerStoreSwiftSource, /var connectionAttemptDisplayName: String \{[\s\S]*activeConnectionAttemptLabel \?\? pairingLabel \?\? lastPairingCredential\?\.displayName \?\? "Chrome"[\s\S]*\}/);
  assert.match(clipScannerStoreSwiftSource, /func cancelConnectionAttempt\(\) \{[\s\S]*reconnectTask\?\.cancel\(\)[\s\S]*transport\.close\(\)[\s\S]*statusText = "Connection canceled"/);
  assert.match(clipRootViewSwiftSource, /@State private var isConnectionSheetPresented = false/);
  assert.match(clipRootViewSwiftSource, /\.onChange\(of: store\.isPairing\) \{ _, isPairing in\s*if isPairing \{\s*isConnectionSheetPresented = true\s*\}\s*\}/);
  assert.match(clipRootViewSwiftSource, /private struct ClipConnectionProgressView: View/);
  assert.match(clipRootViewSwiftSource, /Text\("Connecting"\)/);
  assert.match(clipRootViewSwiftSource, /value: store\.connectionAttemptDisplayName,\s*systemImage: "desktopcomputer"/);
  assert.match(clipRootViewSwiftSource, /value: store\.statusText,\s*systemImage: "waveform\.path\.ecg"/);
  assert.match(clipRootViewSwiftSource, /Label\("Cancel", systemImage: "xmark\.circle"\)/);
  assert.match(clipRootViewSwiftSource, /Label\("Scan QR", systemImage: "qrcode\.viewfinder"\)/);
  assert.match(clipRootViewSwiftSource, /store\.cancelConnectionAttempt\(\)[\s\S]*onScanQRCode\(\)/);
});

test("app clip pairing, reconnect, and failure reuse one connection sheet", () => {
  assert.match(clipRootViewSwiftSource, /@State private var isConnectionSheetPresented = false/);
  assert.match(clipRootViewSwiftSource, /\.sheet\(isPresented: \$isConnectionSheetPresented\)/);
  assert.doesNotMatch(clipRootViewSwiftSource, /isConnectChoicesPresented|isConnectionProgressPresented|isPairingFailurePresented/);
  assert.match(clipRootViewSwiftSource, /private struct ClipConnectionSheet: View/);
  assert.match(clipRootViewSwiftSource, /if store\.isPairing[\s\S]*ClipConnectionProgressView[\s\S]*else if store\.pairingFailureMessage != nil[\s\S]*ClipPairingFailureView[\s\S]*else[\s\S]*ClipConnectChoicesView/);
  assert.match(clipRootViewSwiftSource, /private struct ClipCaptureSessionView: View[\s\S]*\.sheet\(isPresented: \$isConnectionSheetPresented\)[\s\S]*ClipConnectionSheet\(/);
  assert.match(clipRootViewSwiftSource, /\.onChange\(of: store\.isConnected\)[\s\S]*isConnectionSheetPresented = !isConnected/);
});

test("app clip fresh qr connection attempt does not reuse saved session name", () => {
  assert.match(clipScannerStoreSwiftSource, /func handleIncomingURL\(_ url: URL\) \{[\s\S]*pairingLabel = session\.label[\s\S]*activeConnectionAttemptLabel = displayName\(for: session\)[\s\S]*Task \{ await pair\(session\) \}/);
  assert.match(clipScannerStoreSwiftSource, /private func handlePairingValue\(_ value: String, invalidMessage: String\?\) -> Bool \{[\s\S]*pairingLabel = session\.label[\s\S]*activeConnectionAttemptLabel = displayName\(for: session\)[\s\S]*Task \{ await pair\(session\) \}/);
  assert.match(clipScannerStoreSwiftSource, /private func displayName\(for session: PairingSession\) -> String \{\s*let label = session\.label\?\.trimmingCharacters\(in: \.whitespacesAndNewlines\) \?\? ""\s*return label\.isEmpty \? "Chrome" : label\s*\}/);
  assert.doesNotMatch(clipScannerStoreSwiftSource, /session\.label \?\? session\.sessionId/);
  assert.match(clipScannerStoreSwiftSource, /private func scheduleReconnectIfPossible\(reason: String, using credential: ClipPairingCredential\) \{[\s\S]*activeConnectionAttemptLabel = credential\.displayName[\s\S]*targetHint = "Reopening \\\(credential\.displayName\)"/);
  assert.doesNotMatch(clipScannerStoreSwiftSource, /pairingLabel = session\.label \?\? pairingLabel/);
});

test("app clip photo capture and library upload wait for Chrome photo receipts", () => {
  assert.match(clipScannerStoreSwiftSource, /func capturePhoto\(_ image: UIImage, batchId: String\? = nil\) async/);
  assert.match(clipScannerStoreSwiftSource, /\.centerSquareCropped\(\)/);
  assert.match(clipScannerStoreSwiftSource, /await sendPhoto\(photo\)/);
  assert.match(clipScannerStoreSwiftSource, /func uploadPhotos\(_ images: \[UIImage\]\) async/);
  assert.match(clipScannerStoreSwiftSource, /let batchId = ScannerProtocol\.makeMessageId\("upload-batch"\)/);
  assert.match(clipScannerStoreSwiftSource, /let didSend = await sendPhoto\(\s*photo,\s*filename: uploadFilename\(index: index, capturedAt: capturedAt\)\s*\)/);
  assert.match(clipRootViewSwiftSource, /guard !items\.isEmpty else \{ return \}/);
  assert.match(clipTransportSwiftSource, /private var photoContinuations: \[String: CheckedContinuation<ScannerProtocol\.PhotoReceived, Error>\] = \[:\]/);
  assert.match(clipTransportSwiftSource, /ScannerProtocol\.parsePhotoReceived\(rawValue\)/);
  assert.match(clipTransportSwiftSource, /ScannerProtocol\.parsePhotoRejected\(rawValue\)/);
  assert.match(clipTransportSwiftSource, /ScannerProtocol\.photoReceiptTimeout/);
});

test("app clip upload tab groups library photos and shows shared upload progress", () => {
  assert.match(clipScannerStoreSwiftSource, /var photoUploadProgress: PhotoUploadProgress\?/);
  assert.match(clipScannerStoreSwiftSource, /photoUploadProgress = PhotoUploadProgress\(/);
  assert.match(clipScannerStoreSwiftSource, /updatePhotoUploadProgress\(batchId: batchId, prepared: index \+ 1, phase: \.uploading\)/);
  assert.match(clipScannerStoreSwiftSource, /finishPhotoUploadItem\(batchId: batchId, succeeded: didSend\)/);
  assert.match(clipScannerStoreSwiftSource, /finishPhotoUploadBatch\(batchId: batchId\)/);
  assert.match(clipRootViewSwiftSource, /private var uploadPhotoBatches: \[ClipUploadPhotoBatch\]/);
  assert.match(clipRootViewSwiftSource, /let grouped = Dictionary\(grouping: uploadPhotos\) \{ photo in\s*photo\.batchId \?\? photo\.id\.uuidString\s*\}/);
  assert.match(clipRootViewSwiftSource, /PhotoPreparationProgressSummary\(\s*prepared: selectedUploadPrepared,\s*total: selectedUploadTotal\s*\)/);
  assert.match(clipRootViewSwiftSource, /PhotoUploadProgressSummary\(progress: progress\)/);
  assert.match(clipRootViewSwiftSource, /ClipUploadPhotoBatchesSection\(/);
  assert.match(clipRootViewSwiftSource, /private struct ClipUploadPhotoBatchCard: View/);
  assert.match(clipRootViewSwiftSource, /private struct ClipUploadPhotoThumbnail: View/);
  assert.match(clipRootViewSwiftSource, /isUploading: activeUploadProgress != nil/);
  assert.match(clipRootViewSwiftSource, /"Reading \\\(selectedUploadReadCount\) of \\\(selectedUploadTotal\) selected photos"/);
  assert.match(clipRootViewSwiftSource, /"\\\(progress\.title\)\. \\\(progress\.detail\)\."/);
  assert.match(clipRootViewSwiftSource, /store\.removePhotos\(batchId: batch\.id\)/);
});

test("app clip upload picker accepts and queues more photos while a batch is active", () => {
  assert.match(clipRootViewSwiftSource, /@State private var queuedUploadSelections: \[\[PhotosPickerItem\]\] = \[\]/);
  assert.match(clipRootViewSwiftSource, /private func enqueueUploadSelection\(_ items: \[PhotosPickerItem\]\)/);
  assert.match(clipRootViewSwiftSource, /while store\.isConnected, !queuedUploadSelections\.isEmpty/);
  assert.match(clipRootViewSwiftSource, /\.onChange\(of: store\.isConnected\)[\s\S]*if isConnected \{\s*startUploadQueueIfNeeded\(\)/);
  assert.match(clipRootViewSwiftSource, /pickerItems = \[\][\s\S]*enqueueUploadSelection\(items\)/);
  assert.match(clipRootViewSwiftSource, /else if let progress = activeUploadProgress/);
});

test("app clip replays saved captures and photos after connecting", () => {
  assert.match(clipScannerStoreSwiftSource, /self\.sendSavedItemsAfterConnect\(\)/);
  assert.match(clipScannerStoreSwiftSource, /private func sendSavedItemsAfterConnect\(\)/);
  assert.match(clipScannerStoreSwiftSource, /let savedCaptures = captures\.filter \{ \$0\.status == "Saved until connected" \}/);
  assert.match(clipScannerStoreSwiftSource, /let savedPhotos = photos\.filter \{ \$0\.status == "Saved until connected" \}/);
  assert.match(clipScannerStoreSwiftSource, /for capture in savedCaptures \{\s*sendCaptureToChrome\(capture\)\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /for photo in savedPhotos \{\s*await sendPhoto\(photo\)\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /private func sendCaptureToChrome\(_ capture: ClipCapture\)/);
});

test("app clip reconnects unexpected WebRTC disconnects without undoing manual end session", () => {
  assert.match(clipScannerStoreSwiftSource, /private struct ClipPairingCredential/);
  assert.match(clipScannerStoreSwiftSource, /@ObservationIgnored private let signaling = ScannerSignalingClient\(\)/);
  assert.match(clipScannerStoreSwiftSource, /private var reconnectTask: Task<Void, Never>\?/);
  assert.match(clipScannerStoreSwiftSource, /private var suppressNextReconnect = false/);
  assert.match(clipScannerStoreSwiftSource, /private var lastPairingCredential: ClipPairingCredential\?/);
  assert.match(clipScannerStoreSwiftSource, /self\.savePairingCredential\(from: sessionReady\)/);
  assert.match(clipScannerStoreSwiftSource, /if self\.isPairing, status == "Connection closed" \{\s*return\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /PairingSecretStore\.save\(pairing\.pairingSecret, pairingId: pairing\.pairingId\)/);
  assert.match(clipScannerStoreSwiftSource, /let signalURL = pairingSession\?\.signalURL \?\? pairingSession\?\.sourceURL\.signalBaseURL/);
  assert.match(clipScannerStoreSwiftSource, /persistLastPairingCredential\(\)/);
  assert.match(clipScannerStoreSwiftSource, /try\? await signaling\.registerPairing\([\s\S]*pairing,[\s\S]*phoneDeviceId: contributorId,[\s\S]*signalURL: signalURL \?\? ScannerProtocol\.signalURL/);
  assert.match(clipScannerStoreSwiftSource, /transport\.onClosed = \{ \[weak self\] in\s*self\?\.handleTransportClosed\(\)/);
  assert.match(clipScannerStoreSwiftSource, /if isPairing, reconnectTask != nil \{\s*return\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /if wasConnected \{\s*self\.scheduleReconnectIfPossible\(reason: "Connection interrupted"\)/);
  assert.match(clipScannerStoreSwiftSource, /func disconnect\(\) \{\s*suppressNextReconnect = true\s*reconnectTask\?\.cancel\(\)/);
  assert.match(clipScannerStoreSwiftSource, /private func reconnect\(using credential: ClipPairingCredential\) async/);
  assert.match(clipScannerStoreSwiftSource, /let signalURLs = credential\.signalURL\.map \{ \[\$0\] \} \?\? ScannerProtocol\.reconnectSignalURLs/);
  assert.match(clipScannerStoreSwiftSource, /await signaling\.registerPairingCandidates\([\s\S]*phoneDeviceId: contributorId,[\s\S]*signalURLs: signalURLs/);
  assert.match(clipScannerStoreSwiftSource, /try await signaling\.requestReconnect\([\s\S]*signalURLs: signalURLs/);
  assert.match(clipScannerStoreSwiftSource, /let parsedJoinSession = PairingURLParser\.parse\(joinWindow\.sourceURL\)\.0/);
  assert.match(clipScannerStoreSwiftSource, /signalURL: parsedJoinSession\?\.signalURL \?\? joinWindow\.sourceURL\.signalBaseURL \?\? ScannerProtocol\.signalURL/);
  assert.match(clipScannerStoreSwiftSource, /try await transport\.pair\(with: session, contributorId: contributorId\)/);
  assert.match(clipScannerStoreSwiftSource, /try await waitForSessionReady\(timeout: \.seconds\(18\)\)/);
  assert.match(clipScannerStoreSwiftSource, /private func waitForSessionReady\(timeout: Duration\) async throws/);
});

test("app clip pending sends fail promptly when WebRTC closes or errors", () => {
  assert.match(clipTransportSwiftSource, /private func failPendingReceipts\(with error: Error\)/);
  assert.match(clipTransportSwiftSource, /func close\(\) \{[\s\S]*failPendingReceipts\(with: ScannerPairingError\.channelNotOpen\)/);
  assert.match(clipTransportSwiftSource, /case "closed":[\s\S]*failPendingReceipts\(with: ScannerPairingError\.channelNotOpen\)[\s\S]*onClosed\?\(\)/);
  assert.match(clipTransportSwiftSource, /case "error":[\s\S]*answerContinuation\?\.resume\(throwing: ScannerPairingError\.requestFailed\)[\s\S]*failPendingReceipts\(with: ScannerPairingError\.channelNotOpen\)/);
  assert.match(clipTransportSwiftSource, /resultTimeoutTasks\.values\.forEach \{ \$0\.cancel\(\) \}/);
  assert.match(clipTransportSwiftSource, /photoTimeoutTasks\.values\.forEach \{ \$0\.cancel\(\) \}/);
});

test("app clip scanner restricts capture barcodes to UPC/EAN and clears stale scans", () => {
  assert.match(clipBarcodeScannerServiceSwiftSource, /static let captureMetadataObjectTypes: \[AVMetadataObject\.ObjectType\] = \[\s*\.ean13,\s*\.ean8,\s*\.upce,\s*\]/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /metadataOutput\.metadataObjectTypes = Self\.captureMetadataObjectTypes\.filter/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func clearDetectedBarcode\(\) \{\s*barcodeDetectionRevision \+= 1\s*barcodeClearTask\?\.cancel\(\)\s*barcodeClearTask = nil\s*latestScan = nil/);
});

test("app clip OCR reuses the main async recognizer and identifier extractor", () => {
  assert.match(clipOCRServiceSwiftSource, /withCheckedThrowingContinuation/);
  assert.match(clipOCRServiceSwiftSource, /DispatchQueue\.global\(qos: \.userInitiated\)\.async/);
  assert.match(clipOCRServiceSwiftSource, /LiveTextIdentifierMatcher\.match\(text\)/);
  assert.match(clipOCRServiceSwiftSource, /candidate\.boundingBox\(for: match\.range\)/);
  assert.match(clipOCRServiceSwiftSource, /DeviceIdentifierRegionExtractor\.reviewRegions\(from: recognizedRegions\)/);
});

test("App Clip Chrome input-change haptics remain gated to the Dictate tab", () => {
  assert.match(clipScannerStoreSwiftSource, /private var dictationTargetKey: String\?/);
  assert.match(clipScannerStoreSwiftSource, /let didChangeChromeInputTarget = wasConnected[\s\S]*self\.dictationTargetKey != nextTargetKey/);
  assert.match(clipScannerStoreSwiftSource, /if !wasConnected \|\| \(didChangeChromeInputTarget && self\.selectedTab == \.dictate\) \{\s*self\.pairingNotificationFeedback\.notificationOccurred\(\.success\)\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /private func dictationTargetKey\(for sessionReady: ScannerProtocol\.SessionReady\) -> String/);
  assert.match(clipScannerStoreSwiftSource, /sessionReady\.cursorTarget\?\.url/);
});

test("App Clip retains Chrome result receipts for cursor insertion feedback", () => {
  assert.match(scannerProtocolSwiftSource, /struct ResultReceived: Decodable, Equatable/);
  assert.match(scannerProtocolSwiftSource, /static func parseResultReceived\(_ rawValue: String\) -> ResultReceived\?/);
  assert.match(clipTransportSwiftSource, /CheckedContinuation<ScannerProtocol\.ResultReceived, Error>/);
  assert.match(clipTransportSwiftSource, /ScannerProtocol\.parseResultReceived\(rawValue\)/);
});
