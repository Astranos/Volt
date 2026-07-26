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
const computerRegistration = readFileSync(
  new URL("../cloud-scanner/computer-registration.ts", import.meta.url),
  "utf8",
);
const useComputerRegistration = readFileSync(
  new URL("../hooks/useComputerRegistration.ts", import.meta.url),
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
  // The App Clip QR is now a cloud-only workspace grant. The full app's
  // enrollment and WebRTC compatibility paths remain outside this popup.
  assert.doesNotMatch(sidepanel, /workspaceCreateEnrollment/);
  assert.doesNotMatch(popup, /workspaceCreateEnrollment/);
  assert.match(popup, /state\.qrCodeUrl/);
  assert.match(popup, /action: "accessCreateAppClipGrant"/);
  assert.doesNotMatch(popup, /scannerStartForMode|ScannerConnectionStatus|joinWindowExpiresAt/);
});

test("Chrome reactively inserts installed-app speech dictation at the tracked cursor", () => {
  assert.match(offscreen, /api\.cloudWorkspace\.liveDictationDraftsForComputer/);
  assert.match(offscreen, /action: "workspaceOffscreenDictationDraftsChanged"/);
  assert.match(controller, /case "workspaceOffscreenDictationDraftsChanged":/);
  assert.match(background, /createCloudLiveDictationController/);
  assert.doesNotMatch(mobileScanner, /Live from iPhone|liveDictationDraftsForComputer/);
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

test("the sidepanel owns a Convex subscription that cannot be stranded by the offscreen document", () => {
  const workspaceSync = readFileSync(
    new URL("../cloud-scanner/workspace-sync.ts", import.meta.url),
    "utf8",
  );
  const snapshotHook = readFileSync(
    new URL("../hooks/useCloudWorkspaceSnapshot.ts", import.meta.url),
    "utf8",
  );

  // Both the panel and the service worker apply snapshots now, and applying one
  // is a read-modify-write over chrome.storage. Web Locks are what keeps the
  // two from dropping each other's results.
  assert.match(workspaceSync, /navigator\.locks\.request\(WORKSPACE_SYNC_LOCK/);
  assert.match(workspaceSync, /const WORKSPACE_SYNC_LOCK = "volt\.cloudScanner\.workspaceSync"/);
  // One definition of the pipeline: the controller must not keep a private copy.
  assert.match(controller, /createWorkspaceSync/);
  assert.doesNotMatch(controller, /mergePage|hydrateWorkspaceReplica|normalizeWorkspaceSnapshot/);
  // The panel talks to Convex directly — no relay through the service worker or
  // the offscreen document, which is exactly what used to leave it empty.
  assert.match(snapshotHook, /useConvex\(\)/);
  assert.match(snapshotHook, /api\.cloudWorkspace\.workspaceSnapshot/);
  assert.match(snapshotHook, /api\.cloudWorkspace\.createPhotoDownloadUrl/);
  assert.doesNotMatch(snapshotHook, /chrome\.runtime\.sendMessage/);
  assert.match(sidepanelEntry, /ConvexProviderWithClerk/);
  assert.match(sidepanelEntry, /useAuth=\{useAuth\}/);
  // The offscreen subscription stays: it is the panel-closed path.
  assert.match(offscreen, /api\.cloudWorkspace\.workspaceSnapshot/);
  // A failed sync says so instead of showing an empty timeline.
  assert.match(mobileScanner, /useCloudWorkspaceSnapshot\(\)/);
  assert.match(mobileScanner, /cloudWorkspace\.error/);
});

test("panel-side cloud sync survives unmounts, sign-out and a refused handshake", () => {
  const workspaceSync = readFileSync(
    new URL("../cloud-scanner/workspace-sync.ts", import.meta.url),
    "utf8",
  );
  const hydration = readFileSync(
    new URL("../cloud-scanner/workspace-hydration.ts", import.meta.url),
    "utf8",
  );
  const snapshotHook = readFileSync(
    new URL("../hooks/useCloudWorkspaceSnapshot.ts", import.meta.url),
    "utf8",
  );

  // MobileScanner unmounts on every tool switch, and this document never
  // receives its own runtime.sendMessage broadcast, so apply results have to
  // live outside component state or a remount waits forever.
  assert.match(snapshotHook, /useSyncExternalStore\(subscribeToApplyState, readApplyState\)/);
  // Signing out drops the previous account's cloud rows even with no offscreen
  // document to send workspaceOffscreenAccountChanged.
  assert.match(snapshotHook, /clerkSignedIn === false\) clearAppliedWorkspace\(\)/);
  assert.match(snapshotHook, /resetActiveHistory\(\)/);
  // A Clerk session Convex refuses is named instead of leaving a silent empty
  // timeline behind a skipped query.
  assert.match(snapshotHook, /handshakeStalled/);
  // Every branch of the entry gives useConvexAuth a provider to read.
  assert.doesNotMatch(sidepanelEntry, /<ConvexProvider[\s>]/);
  assert.match(sidepanelEntry, /ConvexProviderWithAuth client=\{convexClient\} useAuth=\{useNoAuth\}/);
  // Hydration failures reach the panel instead of being swallowed, and one bad
  // photo does not strand the results behind it.
  assert.doesNotMatch(workspaceSync, /hydrateWorkspaceReplica\([^)]*\)[\s\S]{0,80}catch\(\(\) => undefined\)/);
  assert.match(workspaceSync, /if \(hydrationError\) throw hydrationError/);
  assert.match(hydration, /could not be downloaded/);
});

test("editable tracking is a document-idle all-frame content script", () => {
  assert.match(editableTracker, /installEditableTracker\(\)/);
  assert.match(editableTracker, /runAt: "document_idle"/);
  assert.match(editableTracker, /allFrames: true/);
  assert.match(manifest, /mobile-scanner-editable-tracker\.js/);
  assert.match(manifest, /match_about_blank: true/);
  assert.match(editableBridge, /if \(root\.__voltEditableTrackerInstalled\) return null/);
});

test("computer registration is shared and persists the canonical capabilities", () => {
  assert.match(
    computerRegistration,
    /const COMPUTER_CAPABILITIES = \[\s*"workspace-results",\s*"cursor-insertion",\s*"photo-download",?\s*\]/,
  );
  assert.match(computerRegistration, /api\.cloudWorkspace\.registerComputer/);
  assert.match(
    computerRegistration,
    /storageLocal\.set\(\{ \[COMPUTER_REGISTRATION_KEY\]: registration \}\)/,
  );
  assert.match(computerRegistration, /ttlMs: COMPUTER_REGISTRATION_TTL_MS/);
  // Keyed by install id so a second registering context refreshes the same row
  // rather than listing the computer twice on the phone.
  assert.match(computerRegistration, /installationId: identity\.installId/);
  assert.doesNotMatch(controller, /registerComputer|computerRegistration|COMPUTER_PRESENCE/);
});

test("the panel registers this computer so presence does not depend on the offscreen document", () => {
  // The offscreen document reaches Clerk through the mirrored account cookie.
  // When that produces no session it stops without erroring, which left the
  // phone with no computer to show and no failure to explain it.
  assert.match(useComputerRegistration, /registerComputer\(convex\)/);
  assert.match(useComputerRegistration, /if \(!isAuthenticated\) return/);
  assert.match(useComputerRegistration, /setInterval\(beat, COMPUTER_REGISTRATION_INTERVAL_MS\)/);
  assert.match(useComputerRegistration, /clearInterval\(timer\)/);
  // Mounted at the panel root: MobileScanner unmounts on every tool switch,
  // which would let presence lapse while another tool is open.
  assert.match(sidepanel, /useComputerRegistration\(\)/);
  assert.doesNotMatch(mobileScanner, /useComputerRegistration/);
  // A signed-out offscreen document is no longer silent about it.
  assert.match(offscreen, /offscreen has no Clerk session/);
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
  // A cold start has to evaluate the whole module graph first, so the ping
  // budget backs off instead of expiring in a fixed 1.5s.
  assert.match(scannerOffscreen, /PING_MAX_RETRY_DELAY_MS/);
  // And the document answers that ping before it opens any sockets.
  const pingIndex = offscreen.indexOf('"scannerOffscreenPing"');
  assert.ok(pingIndex > 0);
  assert.ok(pingIndex < offscreen.indexOf("cloudWorkspaceSubscriptions.start()"));
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
  // client on an unchanged value spins the handshake into a rate limit, so the
  // mirror reports a change only when the value actually changed.
  assert.match(
    sessionMirror,
    /if \(\(stored\[CLERK_CLIENT_JWT_CACHE_KEY\] \?\? null\) === value\) return/,
  );
  // The offscreen document cannot watch chrome.storage for that key, so the
  // account change is pushed to it and drops its cached Clerk client.
  assert.match(background, /cloudWorkspace\.handleAccountSessionChanged\(\)/);
  assert.match(controller, /startSubscriptions\(true\)/);
  assert.match(offscreen, /accountChanged\(\)/);
  assert.doesNotMatch(offscreen, /chrome\.storage\.onChanged|chrome\.storage\.local\./);
  // The empty panel states the one thing that can actually be missing.
  assert.match(mobileScanner, /signedOut=\{isSignedIn === false\}/);
  assert.doesNotMatch(mobileScannerCards, /Phone sync is not connected/);
  // The reconcile pass must not be able to reject into silence again.
  assert.match(offscreen, /auth reconcile failed/);
});

test("the offscreen document shares the service worker's storage", () => {
  const storageLocal = readFileSync(
    new URL("../access/storage-local.ts", import.meta.url),
    "utf8",
  );
  const identity = readFileSync(
    new URL("../domain/mobile-scanner-identity.ts", import.meta.url),
    "utf8",
  );
  const storageCache = readFileSync(
    new URL("../offscreen/offscreen-storage-cache.ts", import.meta.url),
    "utf8",
  );

  // chrome.storage is absent in an offscreen document, so a context that fell
  // back to its own localStorage minted a second install id and listened for
  // cursor deliveries on a computer the phone never addresses.
  assert.match(storageLocal, /action: OFFSCREEN_STORAGE_ACTION/);
  assert.match(identity, /storageLocal\.get\(keys\)/);
  assert.match(identity, /storageLocal\.set\(values\)/);
  assert.doesNotMatch(identity, /chrome\?\.storage/);
  // Clerk's key stays unprefixed so it resolves to the one the mirror writes.
  assert.match(storageCache, /keys\.filter\(Boolean\)\.join\("\|"\)/);
  assert.match(storageCache, /storageLocal\.get\(\[key\]\)/);
  // Served only to the offscreen document, over the existing trust gate.
  assert.match(controller, /rawRecord\?\.action === "workspaceOffscreenStorage"/);
  assert.match(controller, /case "workspaceOffscreenStorage":/);
  assert.match(controller, /\["\/offscreen\.html"\]/);
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
