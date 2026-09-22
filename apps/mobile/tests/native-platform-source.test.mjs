import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { scannerProtocolGolden } from "@volt/scanner-protocol/protocol-fixtures";
import {
  escapeRegExp,
  swiftStringArrayLiteral,
  swiftRawValueList,
  appSwiftSource,
  scannerStoreSwiftSource,
  scannerStoreCaptureActionsSwiftSource,
  scannerSignalingSwiftSource,
  scannerProtocolSwiftSource,
  pairingURLParserSwiftSource,
  rootViewSwiftSource,
  capturedResultRowSwiftSource,
  captureSessionViewSwiftSource,
  clipViewsSwiftSource,
  clipScannerStoreSwiftSource,
  xcodeProjectSource,
  infoPlistSource,
  clipInfoPlistSource,
  podfileSource,
  removedFullAppSources,
} from "./native-source-fixtures.mjs";

test("both iOS targets exclude WebRTC while the App Clip retains cloud workspace pairing", () => {
  for (const filename of removedFullAppSources) {
    assert.equal(existsSync(new URL(`../ios/Volt/Services/${filename}`, import.meta.url)), false);
    assert.equal(existsSync(new URL(`../ios/Volt/Views/${filename}`, import.meta.url)), false);
    assert.doesNotMatch(xcodeProjectSource, new RegExp(escapeRegExp(filename)));
  }
  assert.equal(existsSync(new URL("../ios/Volt/Services/SpeechDictationService.swift", import.meta.url)), true);
  assert.equal(existsSync(new URL("../ios/Volt/Services/ScannerStoreDictation.swift", import.meta.url)), true);
  assert.equal(existsSync(new URL("../ios/Volt/Views/DictationView.swift", import.meta.url)), true);
  assert.match(xcodeProjectSource, /SpeechDictationService\.swift in Sources/);
  assert.match(xcodeProjectSource, /ScannerStoreDictation\.swift in Sources/);
  assert.match(xcodeProjectSource, /DictationView\.swift in Sources/);
  assert.doesNotMatch(appSwiftSource, /PairingURLParser|volt:\/\/pair/);
  assert.doesNotMatch(scannerStoreSwiftSource, /ScannerWebRTCConnection|ScannerSignalingClient|PairingURLParser|PairingSecretStore|connectionStatus|peerTarget|DictationModel/);
  assert.doesNotMatch(scannerStoreCaptureActionsSwiftSource, /sendCaptureResultOverWebRTC|photoRetryQueue|sendRetryablePhotos|sendQueuedPhoto|sendDictation/);
  assert.doesNotMatch(rootViewSwiftSource, /PairingSessionsView|PairingStatusSheet/);
  assert.match(rootViewSwiftSource, /CaptureHistoryView\(\)/);
  assert.match(captureSessionViewSwiftSource, /store\.activeMode == \.dictation/);
  assert.match(infoPlistSource, /NSMicrophoneUsageDescription/);
  assert.match(infoPlistSource, /NSSpeechRecognitionUsageDescription/);
  assert.doesNotMatch(podfileSource, /JitsiWebRTC/);
  assert.doesNotMatch(scannerProtocolSwiftSource, /PhotoDeliveryReceipt|struct PhotoChunkAck|parsePhotoChunkAck|static func helloMessage|static func dictationMessage/);
  assert.match(capturedResultRowSwiftSource, /case \.dictation: "Dictation"/);
  assert.match(capturedResultRowSwiftSource, /case \.dictation: "mic"/);
  assert.match(rootViewSwiftSource, /CaptureHistoryView\(\)/);
  assert.equal(existsSync(new URL("../ios/Volt/Views/SessionsView.swift", import.meta.url)), false);
  assert.match(xcodeProjectSource, /B3000000000000000000000C \/\* PairingURLParser\.swift in Sources \*\//);
  assert.match(xcodeProjectSource, /B30000000000000000000021 \/\* AppClipGuestCloudClient\.swift in Sources \*\//);
  assert.doesNotMatch(xcodeProjectSource, /WebKitWebRTCTransport\.swift|webrtc-bridge\.html/);
  assert.doesNotMatch(clipScannerStoreSwiftSource + clipViewsSwiftSource, /WebKit|WebRTC|ScannerSignalingClient|ScannerProtocol/);
  assert.match(clipInfoPlistSource, /NSMicrophoneUsageDescription/);
  assert.match(clipInfoPlistSource, /NSSpeechRecognitionUsageDescription/);
  assert.equal(existsSync(new URL("../ios/VoltClip/Services/WebKitWebRTCTransport.swift", import.meta.url)), false);
  assert.equal(existsSync(new URL("../ios/VoltClip/Resources/webrtc-bridge.html", import.meta.url)), false);
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
  assert.match(pairingURLParserSwiftSource, /cloudURL: query\["cloudUrl"\]\.flatMap\(URL\.init\(string:\)\)/);
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
});

test("Audio mode stops and hides the camera feed in both iOS targets", () => {
  assert.match(captureSessionViewSwiftSource, /ScannerCameraLayer[\s\S]*\.opacity\(store\.activeMode == \.dictation \? 0 : 1\)/);
  assert.match(captureSessionViewSwiftSource, /if isReviewingOcr \|\| store\.activeMode == \.dictation \{\s*store\.camera\.stop\(\)\s*return\s*\}/);
  assert.match(clipViewsSwiftSource, /ClipCaptureSessionBackdrop[\s\S]*\.opacity\(activeMode == \.dictation \? 0 : 1\)/);
  assert.match(clipViewsSwiftSource, /if activeMode == \.dictation \{\s*cameraService\.stop\(\)\s*return\s*\}/);
});
