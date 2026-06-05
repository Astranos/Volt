import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scannerStateSource = readFileSync(
  new URL("./scanner-state.tsx", import.meta.url),
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
