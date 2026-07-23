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
  assert.match(offscreenSource, /syncHost: CLERK_SYNC_HOST/);
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
  assert.match(
    manifestSource,
    /permissions:\s*\[[\s\S]*["']cookies["'][\s\S]*\]/,
  );
});

test("new tab has a compact account control and no duplicate tool buttons", async () => {
  const newTabSource = await readFile(
    new URL("../../entrypoints/newtab/NewTab.tsx", import.meta.url),
    "utf8",
  );

  assert.match(newTabSource, /ExtensionAccountControl/);
  assert.match(newTabSource, /surface="newtab"/);
  assert.match(newTabSource, /action: "open-settings"/);
  assert.doesNotMatch(newTabSource, /SIDEPANEL_TOOLS\.map/);
  assert.doesNotMatch(
    newTabSource,
    /openMobileCapturePopup|Pair Phone|action: "openInSidebar"/,
  );
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
  assert.match(unifiedSidepanelSource, /workspaceCreateEnrollment/);
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
