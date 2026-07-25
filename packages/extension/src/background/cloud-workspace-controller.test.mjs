import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { convexDeploymentUrlFromHttpActionsUrl } from "../access/config.ts";

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
const mobileScanner = readFileSync(
  new URL("../components/sidepanel/MobileScanner.tsx", import.meta.url),
  "utf8",
);
const extensionAccess = readFileSync(
  new URL("../components/access/ExtensionAccess.tsx", import.meta.url),
  "utf8",
);
const offscreen = readFileSync(
  new URL("../offscreen/mobile-scanner-offscreen.ts", import.meta.url),
  "utf8",
);
const editableTracker = readFileSync(
  new URL("../../entrypoints/mobile-scanner-editable-tracker.ts", import.meta.url),
  "utf8",
);
const editableBridge = readFileSync(
  new URL("../components/sidepanel/mobile-scanner-page-bridge.ts", import.meta.url),
  "utf8",
);
const manifest = readFileSync(new URL("../../wxt.config.ts", import.meta.url), "utf8");

test("Convex deployment URL maps explicitly from HTTP Actions", () => {
  assert.equal(
    convexDeploymentUrlFromHttpActionsUrl("https://sincere-trout-414.convex.site/api/signal"),
    "https://sincere-trout-414.convex.cloud",
  );
  assert.throws(
    () => convexDeploymentUrlFromHttpActionsUrl("https://api.example.com/api/signal"),
    /\.convex\.site/,
  );
});

test("workspace operations relay through the authenticated offscreen Convex client", () => {
  assert.doesNotMatch(controller, /fetch\(|Authorization|\/api\/workspace/);
  assert.match(controller, /action: "workspaceOffscreenCreateEnrollment"/);
  assert.match(controller, /action: "workspaceOffscreenCreatePhotoDownloadUrl"/);
  assert.match(controller, /action: "workspaceOffscreenDeleteResults"/);
  assert.match(controller, /action: "workspaceOffscreenRestoreResults"/);
  assert.match(offscreen, /api\.cloudWorkspace\.createEnrollment/);
  assert.match(offscreen, /api\.cloudWorkspace\.createPhotoDownloadUrl/);
  assert.match(offscreen, /api\.cloudWorkspace\.deleteWorkspaceResults/);
  assert.match(offscreen, /api\.cloudWorkspace\.restoreWorkspaceResults/);
  assert.match(background, /ensureOffscreenDocument: scannerOffscreen\.ensureScannerOffscreenDocument/);
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
  assert.match(extensionAccess, /publishClerkConvexToken\(token\)/);
  assert.match(offscreen, /setAuth\(getClerkToken/);
  assert.match(offscreen, /api\.cloudWorkspace\.createEnrollment/);
  assert.doesNotMatch(controller, /clerkToken|getClerkToken/);
});

test("workspace sync is reactive without sidepanel reconciliation chatter", () => {
  assert.match(offscreen, /new ConvexClient/);
  assert.match(offscreen, /setAuth\(getClerkToken/);
  assert.match(offscreen, /api\.cloudWorkspace\.workspaceSnapshot/);
  assert.match(offscreen, /api\.cloudWorkspace\.pendingCursorDeliveries/);
  assert.match(offscreen, /getMobileScannerExtensionIdentity/);
  assert.match(offscreen, /api\.cloudWorkspace\.acknowledgeCursorDelivery/);
  assert.doesNotMatch(mobileScanner, /workspaceReconcile|10_000/);
  assert.doesNotMatch(extensionAccess, /workspaceReconcile/);
});

test("editable tracking is a document-idle all-frame content script", () => {
  assert.match(editableTracker, /installEditableTracker\(\)/);
  assert.match(editableTracker, /runAt: "document_idle"/);
  assert.match(editableTracker, /allFrames: true/);
  assert.match(manifest, /mobile-scanner-editable-tracker\.js/);
  assert.match(manifest, /match_about_blank: true/);
  assert.match(editableBridge, /if \(root\.__voltEditableTrackerInstalled\) return null/);
});

test("offscreen owns computer registration and persists the canonical capabilities", () => {
  assert.match(
    offscreen,
    /const COMPUTER_CAPABILITIES = \[\s*"workspace-results",\s*"cursor-insertion",\s*"photo-download",?\s*\]/,
  );
  assert.match(offscreen, /api\.cloudWorkspace\.registerComputer/);
  assert.match(offscreen, /chrome\.storage\.local\.set\(\{ \[COMPUTER_REGISTRATION_KEY\]: registration \}\)/);
  assert.match(offscreen, /ttlMs: COMPUTER_REGISTRATION_TTL_MS/);
  assert.doesNotMatch(controller, /registerComputer|computerRegistration|COMPUTER_PRESENCE/);
});

test("ensuring the offscreen document is single flight and survives a slow start", () => {
  const scannerOffscreen = readFileSync(
    new URL("./scanner-offscreen.ts", import.meta.url),
    "utf8",
  );

  // Startup and two 1-minute alarms all ensure the document concurrently. One
  // caller closing the document another just created is what stranded the
  // cloud workspace with no error anywhere.
  assert.match(scannerOffscreen, /if \(ensurePromise\) return ensurePromise/);
  // A document that has not finished evaluating its module has no listener yet;
  // one missed ping must not be read as a broken document.
  assert.match(scannerOffscreen, /pingScannerOffscreen\(PING_ATTEMPTS\)/);
});

test("workspace sync failures are recorded and named in the panel", () => {
  // A blank results panel is indistinguishable from a broken one, so every
  // stage that can strand the workspace records why, and the empty state says it.
  assert.match(offscreen, /recordWorkspaceDiagnostic/);
  assert.match(offscreen, /offscreen_cookies_unavailable/);
  assert.match(offscreen, /stage: "registration"/);
  assert.match(extensionAccess, /stage: "sidepanel-token"/);
  assert.match(mobileScanner, /summarizeWorkspaceDiagnostics/);
  assert.match(mobileScanner, /syncIssue=\{syncIssue\}/);
  // The reconcile pass must not be able to reject into silence again.
  assert.match(offscreen, /auth reconcile failed/);
});

test("workspace alarm keeps the offscreen document and its subscriptions alive", () => {
  assert.match(controller, /WORKSPACE_OFFSCREEN_LIVENESS_ALARM/);
  assert.match(controller, /periodInMinutes: 1/);
  assert.match(controller, /await options\.ensureOffscreenDocument\(\)/);
  // A live document with dead subscriptions is the failure that stranded the
  // workspace until a service worker restart, so the alarm re-asserts them.
  assert.match(controller, /if \(ready\) await startSubscriptions\(\)/);
  assert.doesNotMatch(controller, /presence heartbeat|Initial computer registration/);
});
