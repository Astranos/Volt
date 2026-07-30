import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clerkFrontendApiFromPublishableKey } from "./config.ts";

test("Clerk sync host is derived from the publishable key", () => {
  const frontendApi = "clerk.example.com";
  const publishableKey = `pk_live_${Buffer.from(`${frontendApi}$`).toString("base64")}`;

  assert.equal(
    clerkFrontendApiFromPublishableKey(publishableKey),
    `https://${frontendApi}`,
  );
  assert.equal(clerkFrontendApiFromPublishableKey("not-a-key"), "");
});

test("Clerk build variables use statically replaceable import.meta.env access", async () => {
  const configSource = await readFile(
    new URL("./config.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    configSource,
    /import\.meta\.env\?\.WXT_CLERK_PUBLISHABLE_KEY/,
  );
  assert.doesNotMatch(configSource, /const extensionEnv/);
});

test("extension auth delegates web sign-in and syncs the Clerk session", async () => {
  const providerSource = await readFile(
    new URL("../components/access/ExtensionAccess.tsx", import.meta.url),
    "utf8",
  );
  const backgroundSource = await readFile(
    new URL("../background/access-controller.ts", import.meta.url),
    "utf8",
  );
  const offscreenSource = await readFile(
    new URL("../offscreen/mobile-scanner-offscreen.ts", import.meta.url),
    "utf8",
  );
  const popupSource = await readFile(
    new URL("../../entrypoints/mobile-scanner-popup/main.tsx", import.meta.url),
    "utf8",
  );
  const sidepanelSource = await readFile(
    new URL("../../entrypoints/sidepanel/main.tsx", import.meta.url),
    "utf8",
  );
  const accessStyles = await readFile(
    new URL("../components/access/ExtensionAccess.css", import.meta.url),
    "utf8",
  );
  const unifiedSidepanelSource = await readFile(
    new URL("../components/sidepanel/UnifiedSidepanel.tsx", import.meta.url),
    "utf8",
  );
  const manifestSource = await readFile(
    new URL("../../wxt.config.ts", import.meta.url),
    "utf8",
  );

  assert.match(providerSource, /syncHost=\{CLERK_SYNC_HOST\}/);
  assert.match(
    providerSource,
    /CLERK_SYNC_HOST/,
  );
  assert.match(
    providerSource,
    /chrome\.tabs\.create\(\{ url: CLERK_SIGN_IN_URL \}\)/,
  );
  assert.doesNotMatch(providerSource, /<SignInButton/);
  // The offscreen document has no chrome.cookies to run the syncHost handshake
  // with, so it reads the client JWT the service worker mirrors for it instead.
  // It has no chrome.storage either, and Clerk's default cache goes straight to
  // browser.storage.local, so the cache has to be supplied.
  assert.match(offscreenSource, /storageCache: offscreenStorageCache/);
  // An unreachable Clerk is not a sign-out: reporting one wipes the local
  // result history, and tearing down subscriptions on it stranded the
  // workspace. The reconcile pass must leave both intact.
  assert.match(offscreenSource, /if \(auth\.status === "unknown"\) return;/);
  // One cached background client, not a Frontend API handshake per reconcile.
  assert.match(offscreenSource, /backgroundClerkPromise/);
  // Clerk validates the manifest before it will mint a token, but offscreen
  // documents have no chrome.runtime.getManifest, so every token fetch died on
  // a TypeError. The manifest has to be readable before Clerk is imported.
  assert.match(offscreenSource, /ensureManifestAccess\(\)\s*\n?\s*\.then\(\(\) => import\("@clerk\/chrome-extension\/client"\)\)/);
  assert.match(offscreenSource, /fetch\("\/manifest\.json"\)/);
  assert.doesNotMatch(backgroundSource, /@clerk\/chrome-extension/);
  assert.match(providerSource, /<ClerkProvider/);
  assert.match(providerSource, /__experimental_syncHostListener/);
  assert.match(providerSource, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(providerSource, /window\.location\.reload\(\)/);
  assert.match(providerSource, /<ClerkLoading>/);
  assert.match(providerSource, /ExtensionAccessErrorBoundary/);
  assert.doesNotMatch(popupSource, /<ExtensionClerkProvider>/);
  assert.doesNotMatch(sidepanelSource, /<ExtensionClerkProvider>/);
  assert.doesNotMatch(popupSource, /ExtensionAccessPanel|ClerkProvider/);
  assert.doesNotMatch(unifiedSidepanelSource, /ExtensionAccessPanel|ClerkProvider/);
  assert.match(unifiedSidepanelSource, /ExtensionAccountControl/);
  // Both extension surfaces use Clerk's session APIs with a plain image
  // trigger/menu, avoiding Clerk's composited Avatar and white popup.
  assert.match(providerSource, /function AccountMenu/);
  assert.match(providerSource, /surface=\{surface\}/);
  assert.match(providerSource, /clerk\.openUserProfile\(\)/);
  assert.match(providerSource, /clerk\.signOut\(\)/);
  assert.match(providerSource, /<img src=\{imageUrl\}/);
  assert.match(accessStyles, /\.extension-account-avatar-frame::after/);
  assert.match(accessStyles, /\.extension-account-popover/);
  assert.match(
    manifestSource,
    /permissions:\s*\[[\s\S]*["']cookies["'][\s\S]*\]/,
  );
});

test("new tab has compact account, App Clip, and settings controls", async () => {
  const newTabSource = await readFile(
    new URL("../../entrypoints/newtab/NewTab.tsx", import.meta.url),
    "utf8",
  );
  const scannerMessageHandlerSource = await readFile(
    new URL("../background/scanner-message-handler.ts", import.meta.url),
    "utf8",
  );

  assert.match(newTabSource, /ExtensionAccountControl/);
  assert.match(newTabSource, /surface="newtab"/);
  assert.match(newTabSource, /<Smartphone \/>/);
  assert.match(newTabSource, /action: "openMobileCapturePopup"/);
  assert.match(newTabSource, /aria-label="Open Volt App Clip QR code"/);
  assert.match(
    scannerMessageHandlerSource,
    /case "openMobileCapturePopup":\s*void handleOpenAppClipPopup/,
  );
  assert.doesNotMatch(
    scannerMessageHandlerSource,
    /case "openMobileCapturePopup":[\s\S]{0,120}scannerOffscreenStart/,
  );
  assert.match(newTabSource, /action: "open-settings"/);
  assert.doesNotMatch(newTabSource, /SIDEPANEL_TOOLS\.map/);
  assert.doesNotMatch(newTabSource, /Pair Phone|action: "openInSidebar"/);
});

test("toolbar opens the sidepanel while Pair Phone owns the QR popup", async () => {
  const backgroundSource = await readFile(
    new URL("../../entrypoints/background.ts", import.meta.url),
    "utf8",
  );
  const manifestSource = await readFile(
    new URL("../../wxt.config.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(manifestSource, /default_popup/);
  assert.match(backgroundSource, /chrome\.action\.onClicked\.addListener/);
  assert.match(
    backgroundSource,
    /sidepanelTools\.toggleForTab\(tab\.id, "mobile-scanner", "open"\)/,
  );
  assert.match(backgroundSource, /chrome\.action\.openPopup\(\)/);
  assert.match(backgroundSource, /chrome\.action\.setPopup\(\{ popup: "" \}\)/);
});

test("pairing popup stays QR-only while sidepanel owns tools and setup", async () => {
  const popupSource = await readFile(
    new URL("../../entrypoints/mobile-scanner-popup/main.tsx", import.meta.url),
    "utf8",
  );
  const unifiedSidepanelSource = await readFile(
    new URL("../components/sidepanel/UnifiedSidepanel.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    popupSource,
    /Offer Calculator|Scanner Results|openSidepanelTool|workspaceCreateEnrollment|open-settings/,
  );
  assert.match(unifiedSidepanelSource, /role="tablist"/);
  assert.match(unifiedSidepanelSource, /SIDEPANEL_TOOLS\.map/);
  assert.doesNotMatch(unifiedSidepanelSource, /workspaceCreateEnrollment/);
  assert.doesNotMatch(unifiedSidepanelSource, /saveMobileScannerSessionLabel/);
  assert.match(popupSource, /saveMobileScannerSessionLabel/);
});

test("sidepanel mounts exactly once around DOM readiness", async () => {
  const sidepanelSource = await readFile(
    new URL("../../entrypoints/sidepanel/main.tsx", import.meta.url),
    "utf8",
  );

  assert.match(sidepanelSource, /document\.readyState === "loading"/);
  assert.match(
    sidepanelSource,
    /addEventListener\("DOMContentLoaded", initSidepanel, \{ once: true \}\)/,
  );
  assert.doesNotMatch(
    sidepanelSource,
    /initSidepanel\(\);[\s\S]*addEventListener\("DOMContentLoaded", initSidepanel\)/,
  );
});
