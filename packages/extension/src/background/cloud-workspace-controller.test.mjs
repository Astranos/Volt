import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controller = readFileSync(new URL("./cloud-workspace-controller.ts", import.meta.url), "utf8");
const background = readFileSync(new URL("../../entrypoints/background.ts", import.meta.url), "utf8");
const popup = readFileSync(new URL("../../entrypoints/mobile-scanner-popup/main.tsx", import.meta.url), "utf8");

test("workspace HTTP actions stay in the authenticated background controller", () => {
  assert.match(controller, /getClerkToken: \(\) => Promise<string \| null>/);
  assert.match(controller, /Authorization: `Bearer \$\{token\}`/);
  assert.match(controller, /"\/api\/workspace\/enrollment"/);
  assert.match(controller, /"\/api\/workspace\/snapshot"/);
  assert.match(controller, /"\/api\/workspace\/photos\/download-url"/);
  assert.match(controller, /"\/api\/workspace\/results\/delete"/);
  assert.match(controller, /"\/api\/workspace\/results\/restore"/);
  assert.match(controller, /"\/api\/workspace\/computers\/register"/);
  assert.match(controller, /installationId: identity\.installId/);
  assert.match(controller, /const COMPUTER_PRESENCE_TTL_MS = 2 \* 60 \* 1000/);
  assert.match(controller, /periodInMinutes: 1/);
  assert.match(background, /getClerkToken: access\.getClerkToken/);
  assert.doesNotMatch(popup, /Authorization|Bearer|deviceSecret|Clerk JWT/);
});

test("full-app enrollment is a second explicit QR and preserves WebRTC pairing", () => {
  assert.match(popup, /action: "workspaceCreateEnrollment"/);
  assert.match(popup, /Enroll full app for cloud sync/);
  assert.match(popup, /short-lived enrollment code, never your account token/);
  assert.match(popup, /state\.qrCodeUrl/);
  assert.match(popup, /action: "scannerStartForMode"/);
});
