import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../ios/${path}`, import.meta.url), "utf8");
const store = read("Volt/Services/QRSignInStore.swift");
const app = read("Volt/App/VoltApp.swift");
const landing = read("Volt/Views/AuthenticationLandingView.swift");
const project = read("Volt.xcodeproj/project.pbxproj");

test("Donut and legacy sign-in links validate through the native URL parser", {
  skip: process.platform !== "darwin" && "requires Swift on macOS",
}, () => {
  const hosts = store.match(/static let signInHosts[^\n]+/)[0];
  const path = store.match(/static let signInPath[^\n]+/)[0];
  const methods = store.slice(store.indexOf("static func signInCode("), store.indexOf("private static func message("));
  const stringExtension = store.slice(store.indexOf("private extension String {"), store.indexOf("enum MobileSignInAPIError:"));
  const directory = mkdtempSync(join(tmpdir(), "donut-sign-in-links-"));
  try {
    const fixture = join(directory, "main.swift");
    writeFileSync(fixture, `
import Foundation
enum QRSignInStore {
  ${hosts}
  ${path}
  ${methods}
}
${stringExtension}
for host in ["donut.juanquenga.com", "voltresale.app", "DONUT.JUANQUENGA.COM"] {
  precondition(QRSignInStore.signInCode(from: URL(string: "https://\\(host)/app-sign-in#code=one-use")!) == "one-use")
  precondition(QRSignInStore.signInCode(from: URL(string: "https://\\(host)/app-sign-in/#code=one-use")!) == "one-use")
  precondition(QRSignInStore.isAppClipURL(URL(string: "https://\\(host)/clip?guestCloudGrant=grant")!))
}
for value in [
  "https://donut.juanquenga.com.evil.test/app-sign-in#code=one-use",
  "https://evil.test/app-sign-in#code=one-use",
  "http://donut.juanquenga.com/app-sign-in#code=one-use",
  "https://donut.juanquenga.com/other#code=one-use",
  "https://donut.juanquenga.com/app-sign-in?code=one-use",
  "https://donut.juanquenga.com/app-sign-in#code=",
] {
  precondition(QRSignInStore.signInCode(from: URL(string: value)!) == nil, value)
}
precondition(!QRSignInStore.isAppClipURL(URL(string: "https://donut.juanquenga.com.evil.test/clip")!))
`);
    execFileSync("xcrun", ["swift", "-swift-version", "6", fixture], { stdio: "pipe" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the full app and App Clip associate both Donut and legacy domains", () => {
  for (const path of ["Volt/Volt.entitlements", "VoltClip/VoltClip.entitlements"]) {
    const source = read(path);
    for (const host of ["donut.juanquenga.com", "voltresale.app"]) {
      assert.ok(source.includes(`<string>appclips:${host}</string>`));
      assert.ok(source.includes(`<string>applinks:${host}</string>`));
    }
  }
});

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
