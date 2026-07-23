import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controller = readFileSync(new URL("./cloud-workspace-controller.ts", import.meta.url), "utf8");
const background = readFileSync(new URL("../../entrypoints/background.ts", import.meta.url), "utf8");
const popup = readFileSync(new URL("../../entrypoints/mobile-scanner-popup/main.tsx", import.meta.url), "utf8");
const sidepanelEntry = readFileSync(
  new URL("../../entrypoints/sidepanel/main.tsx", import.meta.url),
  "utf8",
);
const sidepanel = readFileSync(
  new URL("../components/sidepanel/UnifiedSidepanel.tsx", import.meta.url),
  "utf8",
);

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
  assert.match(sidepanel, /action: "workspaceCreateEnrollment"/);
  assert.match(sidepanel, /Connect installed iPhone app/);
  assert.doesNotMatch(popup, /workspaceCreateEnrollment/);
  assert.match(popup, /state\.qrCodeUrl/);
  assert.match(popup, /action: "scannerStartForMode"/);
});

test("full-app enrollment uses the signed-in sidepanel Clerk session", () => {
  assert.match(sidepanelEntry, /SidepanelClerkProvider/);
  assert.match(sidepanel, /useSidepanelClerkToken/);
  assert.match(sidepanel, /clerkToken/);
  assert.match(controller, /clerkToken: string/);
  assert.match(controller, /registerComputer\(clerkToken\)/);
  assert.match(controller, /request\("\/api\/workspace\/enrollment", "POST", \{ kind: "ios", label \}, clerkToken\)/);
});
