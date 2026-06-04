import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scannerStateSource = readFileSync(
  new URL("./scanner-state.tsx", import.meta.url),
  "utf8"
);

test("mobile waits for Chrome session_ready before showing connected", () => {
  const attachDataChannelStart = scannerStateSource.indexOf("const attachDataChannel = useCallback");
  const postAnswerStart = scannerStateSource.indexOf("const postAnswer = useCallback");
  const handleControlMessageStart = scannerStateSource.indexOf("const handleControlMessage = useCallback");
  assert.ok(attachDataChannelStart > -1);
  assert.ok(postAnswerStart > attachDataChannelStart);
  assert.ok(handleControlMessageStart > -1);

  const attachDataChannelSource = scannerStateSource.slice(
    attachDataChannelStart,
    postAnswerStart
  );
  assert.match(attachDataChannelSource, /kind: "hello"/);
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
