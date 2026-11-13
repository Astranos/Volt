import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../ios/${path}`, import.meta.url), "utf8");
const store = read("Volt/Services/QRSignInStore.swift");
const app = read("Volt/App/VoltApp.swift");
const landing = read("Volt/Views/AuthenticationLandingView.swift");
const project = read("Volt.xcodeproj/project.pbxproj");

test("sign-in links are handled before Clerk and never switch a signed-in account", () => {
  const handler = app.slice(app.indexOf("private func handleIncomingURL"));
  assert.ok(handler.indexOf("qrSignInStore.handleIncomingURL") < handler.indexOf("clerk.handle(url)"));
  assert.match(store, /guard clerk\.user == nil else \{ return true \}/);
});

test("the QR code is read from the URL fragment and redeemed with this phone's request secret", () => {
  assert.match(store, /url\.fragment\(\)/);
  assert.match(store, /signInPath = "\/app-sign-in"/);
  assert.match(store, /apiClient\.redeem\(requestSecret: requestSecret, code: code\)/);
  assert.match(store, /clerk\.auth\.signInWithTicket\(ticket\)/);
  // The request secret lives only in memory, never in UserDefaults.
  assert.doesNotMatch(store, /defaults\.set\(requestSecret/);
});

test("the sign-in screen offers QR sign-in from Chrome", () => {
  assert.match(landing, /Sign in with QR from Chrome/);
  assert.match(landing, /QRSignInView\(\)/);
});

test("QR sign-in is built into the full app only, never the App Clip", () => {
  const sources = project.match(/B8000000000000000000000[12] \/\* QRSignIn\w+\.swift in Sources \*\//g) ?? [];
  // Each file is declared once and listed once in a Sources phase.
  assert.equal(sources.length, 4);
  for (const file of readdirSync(new URL("../ios/VoltClip/", import.meta.url), { recursive: true })) {
    if (!String(file).endsWith(".swift")) continue;
    assert.doesNotMatch(read(`VoltClip/${file}`), /QRSignIn|signInWithTicket/, `${file} must not sign in`);
  }
});
