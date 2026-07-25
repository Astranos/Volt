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
const mobileScannerCards = readFileSync(
  new URL("../components/sidepanel/mobile-scanner-cards.tsx", import.meta.url),
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

test("the phone joins by account, not by an enrollment ceremony in the UI", () => {
  // Enrollment survives only as a background compatibility path for older app
  // builds; nothing in the extension UI asks the user to connect a phone.
  assert.doesNotMatch(sidepanel, /workspaceCreateEnrollment/);
  assert.doesNotMatch(popup, /workspaceCreateEnrollment/);
  assert.match(popup, /state\.qrCodeUrl/);
  assert.match(popup, /action: "scannerStartForMode"/);
});

test("the offscreen workspace signs in from the shared Clerk session itself", () => {
  assert.match(sidepanelEntry, /SidepanelClerkProvider/);
  assert.match(offscreen, /setAuth\(getClerkToken/);
  assert.match(offscreen, /api\.cloudWorkspace\.createEnrollment/);
  assert.doesNotMatch(controller, /clerkToken|getClerkToken/);
  // Offscreen documents have no chrome.cookies, so Clerk cannot run its syncHost
  // handshake there and must fall back to the mirrored client JWT.
  assert.doesNotMatch(offscreen, /syncHost:/);
  assert.match(offscreen, /background: true/);
  // The sidepanel no longer hands the workspace a token, so cloud sync cannot
  // depend on the panel being open.
  assert.doesNotMatch(extensionAccess, /publishClerkConvexToken|getToken\(\{ template/);
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

test("the service worker mirrors the Clerk session the offscreen document reads", () => {
  const sessionMirror = readFileSync(
    new URL("./clerk-session-mirror.ts", import.meta.url),
    "utf8",
  );

  // chrome.cookies exists only in the service worker, so it is the one surface
  // that can turn the browser's __client cookie into the storage cache Clerk
  // falls back to everywhere else.
  assert.match(sessionMirror, /cookies\.get\(/);
  assert.match(sessionMirror, /CLERK_CLIENT_JWT_CACHE_KEY/);
  assert.match(sessionMirror, /cookies\?\.onChanged\.addListener/);
  assert.match(background, /clerkSessionMirror\.initialize\(\)/);
  assert.match(background, /void clerkSessionMirror\.sync\(\)/);
  // Clerk rewrites that key after every Frontend API response; rebuilding the
  // client on an unchanged value spins the handshake into a rate limit.
  assert.match(offscreen, /change\.oldValue === change\.newValue/);
  // The empty panel states the one thing that can actually be missing.
  assert.match(mobileScanner, /signedOut=\{isSignedIn === false\}/);
  assert.doesNotMatch(mobileScannerCards, /Phone sync is not connected/);
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
