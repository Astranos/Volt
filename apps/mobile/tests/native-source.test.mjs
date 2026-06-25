import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const dictationViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/DictationView.swift", import.meta.url),
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
const scannerWebRTCConnectionSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerWebRTCConnection.swift", import.meta.url),
  "utf8"
);
const xcodeProjectSource = readFileSync(
  new URL("../ios/Volt.xcodeproj/project.pbxproj", import.meta.url),
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
  assert.match(scannerSignalingSwiftSource, /try validateSignalResponse\(data: data, response: response\)/);
});

test("native saved-session reconnect waits longer than QR pairing for sleeping Chrome extensions", () => {
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
  assert.match(scannerProtocolSwiftSource, /"capabilities": supportedCapabilities/);
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
  assert.match(scannerWebRTCConnectionSwiftSource, /createJoinAttemptResolvingSignalURL\([\s\S]*allowFallback: session\.signalURL == nil/);
  assert.match(clipTransportSwiftSource, /createJoinAttemptResolvingSignalURL\([\s\S]*allowFallback: session\.signalURL == nil/);
  assert.match(clipTransportSwiftSource, /fetchIceServerConfiguration\([\s\S]*signalURL: resolved\.signalURL/);
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

test("native first-install welcome scanner defers pairing progress sheet until scan cover dismisses", () => {
  assert.match(rootViewSwiftSource, /@State private var showsConnectionSheetAfterWelcomePairingScan = false/);
  assert.match(rootViewSwiftSource, /\.fullScreenCover\(isPresented: \$isWelcomePairingScannerPresented, onDismiss: handleWelcomePairingScannerDismiss\)/);
  assert.match(rootViewSwiftSource, /PairingScanSessionView\(isPresented: \$isWelcomePairingScannerPresented\) \{\s*showsConnectionSheetAfterWelcomePairingScan = true\s*\}/);
  assert.match(rootViewSwiftSource, /private func handleWelcomePairingScannerDismiss\(\) \{\s*guard showsConnectionSheetAfterWelcomePairingScan else \{ return \}\s*showsConnectionSheetAfterWelcomePairingScan = false\s*resetConnectionSheetPresentation\(\)\s*showPairingSheet\(for: store\.connectionStatus\)/);
  assert.match(pairingSessionsViewSwiftSource, /let onPairingCodeAccepted: \(\) -> Void/);
  assert.match(pairingSessionsViewSwiftSource, /init\(isPresented: Binding<Bool>, onPairingCodeAccepted: @escaping \(\) -> Void = \{\}\)/);
  assert.match(pairingSessionsViewSwiftSource, /if store\.pairScannedBarcodeIfNeeded\(\) \{\s*onPairingCodeAccepted\(\)\s*isPresented = false\s*\}/);
});

test("native connection sheet shows pairing failures instead of silently dismissing", () => {
  assert.match(rootViewSwiftSource, /case \.error:/);
  assert.match(rootViewSwiftSource, /title: "Pairing failed"/);
  assert.match(rootViewSwiftSource, /message: store\.targetHint/);
  assert.match(rootViewSwiftSource, /systemImage: "exclamationmark\.triangle"/);
  assert.match(rootViewSwiftSource, /isProgressing: false/);
  assert.match(rootViewSwiftSource, /canCancel: false/);
  assert.match(rootViewSwiftSource, /case \.idle, \.disconnected:/);
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

test("native and app clip keep transient WebRTC disconnects alive through background grace", () => {
  assert.match(scannerWebRTCConnectionSwiftSource, /private var disconnectGraceTask: Task<Void, Never>\?/);
  assert.match(scannerWebRTCConnectionSwiftSource, /private var backgroundTaskIdentifier: UIBackgroundTaskIdentifier = \.invalid/);
  assert.match(scannerWebRTCConnectionSwiftSource, /func setAppIsInBackground\(_ isInBackground: Bool\)/);
  assert.match(scannerWebRTCConnectionSwiftSource, /let graceDuration: Duration = isAppInBackground \? \.seconds\(45\) : \.seconds\(12\)/);
  assert.match(scannerWebRTCConnectionSwiftSource, /UIApplication\.shared\.beginBackgroundTask\(withName: "Volt WebRTC grace"/);
  assert.match(rootViewSwiftSource, /store\.updateAppIsInBackground\(newValue != \.active\)/);
  assert.match(scannerWebRTCConnectionSwiftSource, /case \.disconnected:\s*scheduleDisconnectGrace\(\)/);
  assert.match(scannerWebRTCConnectionSwiftSource, /guard peerConnection\?\.connectionState == \.disconnected else \{ return \}\s*close\(\)/);
  assert.match(clipRootViewSwiftSource, /ClipWebRTCBridgeView\(webView: store\.bridgeWebView\)/);
  assert.match(clipRootViewSwiftSource, /store\.updateAppIsInBackground\(newValue != \.active\)/);
  assert.match(clipTransportSwiftSource, /setDisconnectGraceMs\(\\\(graceMs\)\)/);
  const bridgeSource = readFileSync(new URL("../ios/VoltClip/Resources/webrtc-bridge.html", import.meta.url), "utf8");
  assert.match(bridgeSource, /let disconnectGraceMs = 12000/);
  assert.match(bridgeSource, /setDisconnectGraceMs\(nextGraceMs\)/);
  assert.match(bridgeSource, /pc && pc\.connectionState === "disconnected"[\s\S]*window\.voltBridge\.close\(\)/);
});

test("native screens use the shared header connection control without extra session accessories", () => {
  assert.match(rootViewSwiftSource, /struct ScannerSectionHeader<TrailingAccessory: View>: View/);
  assert.match(rootViewSwiftSource, /trailingAccessory\(\)/);
  assert.doesNotMatch(rootViewSwiftSource, /onSessions/);
  assert.doesNotMatch(rootViewSwiftSource, /struct ScannerSessionsButton: View/);
  assert.match(scannerViewSwiftSource, /ScannerSectionHeader\(\s*title: "Capture",\s*onConnectionControlTapped:/);
  assert.match(dictationViewSwiftSource, /ScannerSectionHeader\(\s*title: "Dictate",\s*onConnectionControlTapped:/);
  assert.match(uploadViewSwiftSource, /ScannerSectionHeader\(\s*title: "Upload",\s*onConnectionControlTapped:/);
  assert.match(rootViewSwiftSource, /private var connectionTitle: String/);
  assert.match(rootViewSwiftSource, /store\.connectionStatus == \.pairing \|\| store\.connectionStatus == \.waitingForChrome[\s\S]*return "Connecting"/);
  assert.match(sharedScannerTabComponentsSwiftSource, /private var connectionColor: Color \{[\s\S]*if connection\.isConnected \{\s*return \.green\s*\}[\s\S]*return \.secondary/);
  assert.doesNotMatch(sharedScannerTabComponentsSwiftSource, /connection\.isBusy \? \.orange : \.secondary/);
  assert.match(clipRootViewSwiftSource, /private func clipConnectionTitle\(\s*isConnected: Bool,\s*isPairing: Bool,\s*pairingLabel: String\?,\s*pairingFailureMessage: String\?\s*\) -> String/);
  assert.match(clipRootViewSwiftSource, /if isPairing \{\s*return "Connecting"\s*\}/);
  assert.match(clipRootViewSwiftSource, /return pairingLabel \?\? "Chrome"/);
  assert.match(clipRootViewSwiftSource, /if pairingFailureMessage != nil \{\s*return "Failed"\s*\}/);
  assert.match(clipRootViewSwiftSource, /private struct ClipPairingFailureView: View/);
  assert.match(clipRootViewSwiftSource, /Label\("Retry", systemImage: "arrow\.clockwise"\)/);
  assert.match(clipRootViewSwiftSource, /Label\("Scan QR Code", systemImage: "qrcode\.viewfinder"\)/);
  assert.doesNotMatch(clipRootViewSwiftSource, /private struct ClipPairingSessionsView: View/);
  assert.doesNotMatch(scannerViewSwiftSource, /trailingAccessory: \{\s*ScannerSessionsButton/);
  assert.doesNotMatch(dictationViewSwiftSource, /trailingAccessory: \{\s*ScannerSessionsButton/);
  assert.doesNotMatch(uploadViewSwiftSource, /trailingAccessory: \{\s*ScannerSessionsButton/);
});

test("native first launch welcomes users without requesting camera access and can open session setup", () => {
  assert.match(rootViewSwiftSource, /@AppStorage\("volt\.hasSeenWelcome\.v1"\) private var hasSeenWelcome = false/);
  assert.match(rootViewSwiftSource, /guard hasSeenWelcome else \{\s*isWelcomePresented = true\s*return\s*\}/);
  assert.match(rootViewSwiftSource, /private struct WelcomeView: View/);
  assert.match(rootViewSwiftSource, /Text\("Welcome to Volt"\)/);
  assert.match(rootViewSwiftSource, /Image\("VoltLogo"\)/);
  assert.match(rootViewSwiftSource, /\.safeAreaInset\(edge: \.bottom, spacing: 0\) \{\s*WelcomeActions/);
  assert.match(rootViewSwiftSource, /Label\("Scan QR Code to Pair", systemImage: "qrcode\.viewfinder"\)/);
  assert.match(rootViewSwiftSource, /Text\("Continue Without Pairing"\)/);
  assert.doesNotMatch(rootViewSwiftSource, /Text\("Continue to Volt"\)/);
  assert.match(rootViewSwiftSource, /private func completeWelcome\(opensPairingScanner: Bool\)/);
  assert.match(rootViewSwiftSource, /private func startAppServices\(\) \{\s*store\.reconnectToMostRecentPairedSessionIfNeeded\(\)\s*\}/);
  assert.doesNotMatch(rootViewSwiftSource, /store\.camera\.requestAccess\(\)/);
  assert.match(captureSessionViewSwiftSource, /\.task \{\s*await store\.camera\.requestAccess\(\)\s*syncCameraForOcrReview/);
  assert.match(pairingSessionsViewSwiftSource, /\.task \{\s*await store\.camera\.requestAccess\(\)\s*store\.camera\.start\(\)\s*\}/);
  assert.match(rootViewSwiftSource, /\.fullScreenCover\(isPresented: \$isWelcomePairingScannerPresented, onDismiss: handleWelcomePairingScannerDismiss\) \{\s*PairingScanSessionView\(isPresented: \$isWelcomePairingScannerPresented\)/);
  assert.match(rootViewSwiftSource, /private func showPairingScannerFromWelcome\(\) \{\s*store\.activeMode = \.barcode\s*showsConnectionSheetAfterWelcomePairingScan = false\s*isWelcomePairingScannerPresented = true\s*\}/);
  assert.doesNotMatch(rootViewSwiftSource, /private func showSessionsFromWelcome/);
  assert.match(pairingSessionsViewSwiftSource, /private let webScannerURL = URL\(string: "https:\/\/volt-scanner\.vercel\.app\/create-session"\)!/);
  assert.match(pairingSessionsViewSwiftSource, /PairingSessionSetupContent \{[\s\S]*openURL\(webScannerURL\)/);
  assert.match(sharedPairingSessionComponentsSwiftSource, /Text\("Scan the QR code from the Chrome extension, or open the create session page on your computer\. This iPhone will connect to that browser session\."\)/);
  assert.match(sharedPairingSessionComponentsSwiftSource, /title: "Open Volt on your computer"/);
  assert.match(sharedPairingSessionComponentsSwiftSource, /detail: "Use the Chrome extension side panel, or go to volt-scanner\.vercel\.app\/create-session\."/);
  assert.match(sharedPairingSessionComponentsSwiftSource, /detail: "Start pairing in Chrome or on the create session page\."/);
  assert.match(sharedPairingSessionComponentsSwiftSource, /Label\("Open Create Session Page", systemImage: "safari"\)/);
  assert.match(sharedPairingSessionComponentsSwiftSource, /Label\("Scan Computer QR", systemImage: "qrcode\.viewfinder"\)/);
  assert.match(rootViewSwiftSource, /\.frame\(maxWidth: \.infinity, alignment: \.leading\)\s*\.background\(\.background, in: RoundedRectangle\(cornerRadius: 16/);
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

test("native scanner normalizes UPC-A barcodes and upload filenames preserve selection order", () => {
  assert.match(scannerStoreCaptureActionsSwiftSource, /normalizedBarcodeScan\(value: value, format: camera\.lastBarcodeFormat \?\? "barcode"\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /trimmedValue\.count == 13/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /trimmedValue\.first == "0"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /return \(String\(trimmedValue\.dropFirst\(\)\), "upc_a"\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /String\(format: "%03d", index \+ 1\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /filename: uploadFilename\(index: index, capturedAt: capturedAt\)/);
});

test("native upload batches expose clear progress while photos are preparing and uploading", () => {
  assert.match(scannerStoreSwiftSource, /struct PhotoUploadProgress: Identifiable, Equatable/);
  assert.match(scannerStoreSwiftSource, /var photoUploadProgress: PhotoUploadProgress\?/);
  assert.match(scannerStoreSwiftSource, /var remainingCount: Int/);
  assert.match(scannerStoreSwiftSource, /"Uploading \\\(min\(finishedCount \+ 1, total\)\) of \\\(total\)"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /photoUploadProgress = PhotoUploadProgress\(/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /updatePhotoUploadProgress\(batchId: batch, prepared: index \+ 1, phase: \.uploading\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /finishPhotoUploadItem\(batchId: batch, resultId: photoResult\.id\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /finishPhotoUploadBatch\(batchId: batch\)/);
  assert.match(uploadViewSwiftSource, /PhotoUploadProgressSummary\(progress: progress\)/);
  assert.match(uploadViewSwiftSource, /ProgressView\(value: progress\.fractionCompleted\)/);
  assert.match(uploadViewSwiftSource, /"Reading \\\(min\(selectedUploadPrepared \+ 1, selectedUploadTotal\)\) of \\\(selectedUploadTotal\) selected photos"/);
  assert.match(uploadViewSwiftSource, /"\\\(progress\.title\)\. \\\(progress\.detail\)\."/);
  assert.match(uploadViewSwiftSource, /"Uploading \\\(results\.count\) of \\\(expectedTotal\) photo/);
  assert.match(readFileSync(new URL("../ios/Volt/Views/SharedScannerTabComponents.swift", import.meta.url), "utf8"), /var isUploading = false/);
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
  assert.match(scannerCameraLayerSwiftSource, /store\.camera\.updateBarcodeGuideRect\(nil\)/);
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
  assert.match(clipRootViewSwiftSource, /if isReviewing \{\s*selectedTextRegion = nil\s*selectedCleanedText = nil\s*cameraService\.setTorchEnabled\(false\)/);
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
  assert.match(clipRootViewSwiftSource, /\.onAppear \{\s*activeMode = \.ocr/);
  assert.match(clipRootViewSwiftSource, /photos: store\.photos\.filter \{ \$0\.source == \.capture \}/);
  assert.match(clipRootViewSwiftSource, /photos: store\.photos\.filter \{ \$0\.source == \.upload \}/);
  assert.match(clipRootViewSwiftSource, /latestPhoto: store\.photos\.first\(where: \{ \$0\.source == \.capture \}\)/);
});

test("app clip photo capture and library upload wait for Chrome photo receipts", () => {
  assert.match(clipScannerStoreSwiftSource, /func capturePhoto\(_ image: UIImage\) async/);
  assert.match(clipScannerStoreSwiftSource, /\.centerSquareCropped\(\)/);
  assert.match(clipScannerStoreSwiftSource, /await sendPhoto\(photo\)/);
  assert.match(clipScannerStoreSwiftSource, /func uploadPhotos\(_ images: \[UIImage\]\) async/);
  assert.match(clipScannerStoreSwiftSource, /let batchId = ScannerProtocol\.makeMessageId\("upload-batch"\)/);
  assert.match(clipScannerStoreSwiftSource, /await sendPhoto\(\s*photo,\s*filename: uploadFilename\(index: index, capturedAt: capturedAt\)\s*\)/);
  assert.match(clipTransportSwiftSource, /private var photoContinuations: \[String: CheckedContinuation<ScannerProtocol\.PhotoReceived, Error>\] = \[:\]/);
  assert.match(clipTransportSwiftSource, /ScannerProtocol\.parsePhotoReceived\(rawValue\)/);
  assert.match(clipTransportSwiftSource, /ScannerProtocol\.parsePhotoRejected\(rawValue\)/);
  assert.match(clipTransportSwiftSource, /ScannerProtocol\.photoReceiptTimeout/);
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
  assert.match(clipScannerStoreSwiftSource, /try\? await signaling\.registerPairing\(pairing, phoneDeviceId: contributorId\)/);
  assert.match(clipScannerStoreSwiftSource, /transport\.onClosed = \{ \[weak self\] in\s*self\?\.handleTransportClosed\(\)/);
  assert.match(clipScannerStoreSwiftSource, /if wasConnected \{\s*self\.scheduleReconnectIfPossible\(reason: "Connection interrupted"\)/);
  assert.match(clipScannerStoreSwiftSource, /func disconnect\(\) \{\s*suppressNextReconnect = true\s*reconnectTask\?\.cancel\(\)/);
  assert.match(clipScannerStoreSwiftSource, /private func reconnect\(using credential: ClipPairingCredential\) async/);
  assert.match(clipScannerStoreSwiftSource, /try await signaling\.requestReconnect\(/);
  assert.match(clipScannerStoreSwiftSource, /try await transport\.pair\(with: session, contributorId: contributorId\)/);
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
  assert.match(scannerViewSwiftSource, /\.onAppear \{\s*store\.selectedSection = \.scan\s*store\.activeMode = ScreenshotScenario\.current\?\.initialCaptureMode \?\? \.ocr/);
  assert.match(dictationViewSwiftSource, /\.onAppear \{\s*store\.selectedSection = \.dictation\s*store\.activeMode = \.dictation\s*\}/);
  assert.match(uploadViewSwiftSource, /\.onAppear \{\s*store\.selectedSection = \.upload\s*\}/);
  assert.match(scannerStoreDictationSwiftSource, /func allowsDictationFeedback\(_ requested: Bool = true\) -> Bool \{\s*requested && selectedSection == \.dictation\s*\}/);
  assert.match(scannerStoreDictationSwiftSource, /if allowsDictationFeedback\(allowsFeedback\) \{\s*dictationNotificationFeedback\.notificationOccurred\(\.success\)\s*\}/);
  assert.match(scannerStoreDictationSwiftSource, /if wasRecording, allowsDictationFeedback\(\) \{\s*dictationImpactFeedback\.impactOccurred\(intensity: 0\.7\)\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /private var dictationTargetKey: String\?/);
  assert.match(clipScannerStoreSwiftSource, /let didChangeChromeInputTarget = wasConnected[\s\S]*self\.dictationTargetKey != nextTargetKey/);
  assert.match(clipScannerStoreSwiftSource, /if !wasConnected \|\| \(didChangeChromeInputTarget && self\.selectedTab == \.dictate\) \{\s*self\.pairingNotificationFeedback\.notificationOccurred\(\.success\)\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /private func dictationTargetKey\(for sessionReady: ScannerProtocol\.SessionReady\) -> String/);
  assert.match(clipScannerStoreSwiftSource, /sessionReady\.cursorTarget\?\.url/);
});

test("native scanner handles Chrome result receipts for cursor insertion feedback", () => {
  assert.match(scannerProtocolSwiftSource, /struct ResultReceived: Decodable, Equatable/);
  assert.match(scannerProtocolSwiftSource, /static func parseResultReceived\(_ rawValue: String\) -> ResultReceived\?/);
  assert.match(scannerWebRTCConnectionSwiftSource, /var onResultReceived: \(\(ScannerProtocol\.ResultReceived\) -> Void\)\?/);
  assert.match(scannerWebRTCConnectionSwiftSource, /ScannerProtocol\.parseResultReceived\(rawValue\)/);
  assert.match(scannerStoreSwiftSource, /func applyResultReceived\(_ receipt: ScannerProtocol\.ResultReceived\)/);
  assert.match(scannerStoreSwiftSource, /receipt\.insertedIntoCursor == false/);
  assert.match(scannerProtocolSwiftSource, /let platform: String\?/);
  assert.match(scannerStoreSwiftSource, /message\.peer\?\.platform == "web" \? "Browser" : "Chrome"/);
  assert.match(scannerStoreSwiftSource, /peerTarget\?\.isWebPageSession == true && receipt\.savedToResults/);
  assert.match(scannerStoreSwiftSource, /statusText = "Successfully sent to browser"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /peerTarget\?\.isWebPageSession == true \? "Sent to browser" : "Sent to Chrome"/);
  assert.match(scannerStoreSwiftSource, /if receipt\.savedToResults \{\s*showCaptureTypingFallbackToast\(for: results\[index\]\)\s*\} else \{\s*showCaptureDeliveryToast\(for: results\[index\], state: \.failed\)\s*\}/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func showCaptureTypingFallbackToast\(for result: ScanResult\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /title: "Failed to type"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /was saved to Chrome sidepanel results/);
  assert.match(scannerStoreSwiftSource, /\(browserName\) saved it, but no focused cursor target was available\./);
});

test("native photo delivery uses a durable retry queue until browser receipt", () => {
  assert.match(scannerStoreCaptureActionsSwiftSource, /final class MobilePhotoRetryQueue/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /static let recoveryWindow: TimeInterval = 24 \* 60 \* 60/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /enum Status: String, Codable, Equatable \{[\s\S]*case queued[\s\S]*case sending[\s\S]*case sent[\s\S]*case failed[\s\S]*case received[\s\S]*case cancelled/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /appendingPathComponent\("VoltPhotoRetryQueue", isDirectory: true\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func enqueue\(payload: ScannerProtocol\.PhotoPayload, resultId: UUID, now: Date = \.now\) -> Entry\?/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func expireEntries\(now: Date = \.now\) -> \[Entry\]/);
  assert.match(scannerStoreSwiftSource, /@ObservationIgnored var photoRetryQueue = MobilePhotoRetryQueue\(\)/);
  assert.match(scannerStoreSwiftSource, /Task \{ await sendRetryablePhotos\(\) \}/);
  assert.match(scannerWebRTCConnectionSwiftSource, /var onPhotoTransferCompleted: \(\(String\) -> Void\)\?/);
  assert.match(scannerWebRTCConnectionSwiftSource, /func sendPhoto\(_ payload: ScannerProtocol\.PhotoPayload\) async throws -> ScannerProtocol\.PhotoDeliveryReceipt/);
  assert.match(scannerWebRTCConnectionSwiftSource, /onPhotoTransferCompleted\?\(payload\.id\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /photoRetryQueue\.markSent\(photoId: photoId\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /photoRetryQueue\.markReceived\(photoId: photoId\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /removeData\(photoId: photoId\)/);
});
