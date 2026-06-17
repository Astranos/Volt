import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scannerStateSource = readFileSync(
  new URL("./scanner-state.tsx", import.meta.url),
  "utf8"
);
const scannerStoreSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerStore.swift", import.meta.url),
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

test("mobile waits for Chrome session_ready before showing connected", () => {
  const attachDataChannelStart = scannerStateSource.indexOf("const attachDataChannel = useCallback");
  const pairWithOfferStart = scannerStateSource.indexOf("const pairWithOffer = useCallback");
  const handleControlMessageStart = scannerStateSource.indexOf("const handleControlMessage = useCallback");
  assert.ok(attachDataChannelStart > -1);
  assert.ok(pairWithOfferStart > attachDataChannelStart);
  assert.ok(handleControlMessageStart > -1);

  const attachDataChannelSource = scannerStateSource.slice(
    attachDataChannelStart,
    pairWithOfferStart
  );
  assert.match(attachDataChannelSource, /buildMobileHelloMessage/);
  assert.match(attachDataChannelSource, /const handleControlOpen = \(\) =>/);
  assert.match(attachDataChannelSource, /if \(channel\.readyState === "open"\) handleControlOpen\(\)/);
  assert.match(attachDataChannelSource, /if \(channel\.readyState === "open"\) handlePhotoOpen\(\)/);
  assert.doesNotMatch(attachDataChannelSource, /setStatus\("session_ready"\)/);
  assert.doesNotMatch(attachDataChannelSource, /sessionReadyRef\.current = true/);

  const handleControlMessageSource = scannerStateSource.slice(handleControlMessageStart);
  assert.match(handleControlMessageSource, /message\.kind === "session_ready"/);
  assert.match(handleControlMessageSource, /setStatus\("session_ready"\)/);
  assert.match(handleControlMessageSource, /sessionReadyRef\.current = true/);
});

test("full app pairing accepts only WebRTC pairing URL shapes", () => {
  assert.match(scannerStateSource, /parseMobileWebRtcPairingUrl\(url\)/);
  assert.doesNotMatch(scannerStateSource, /Linking\.parse\(url\)/);
  assert.doesNotMatch(scannerStateSource, /Linking\.parse/);
  assert.match(scannerStateSource, /pairing\.type === "offer"/);
  assert.match(scannerStateSource, /pairing\.type === "join-token"/);
});

test("mobile photo delivery stays on WebRTC retry queue primitives", () => {
  assert.match(scannerStateSource, /chunkPhotoBase64\(next\.dataBase64\)/);
  assert.match(scannerStateSource, /photo_chunk_ack/);
  assert.match(scannerStateSource, /photo_received/);
  assert.match(scannerStateSource, /markRetryableAfterDisconnect/);
  assert.doesNotMatch(scannerStateSource, /uploadPhotoObjectTransfer/);
});

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
  assert.match(scannerSignalingSwiftSource, /let deadline = ContinuousClock\.now \+ ScannerProtocol\.reconnectRequestTTL/);
});
