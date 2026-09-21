import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("tracked text does not send users to retired public domains", () => {
  const retired = [
    ["volt", "juanquenga", "com"].join("."),
    ["volt-scanner", "vercel", "app"].join("."),
  ];
  const result = spawnSync("git", ["grep", "-I", "-l", "-F", ...retired.flatMap((host) => ["-e", host]), "--", "."], { cwd: root, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 1, `Retired domains remain in tracked files:\n${result.stdout}${result.stderr}`);
});

test("both native targets associate with the public app domain", () => {
  for (const path of ["apps/mobile/ios/Volt/Volt.entitlements", "apps/mobile/ios/VoltClip/VoltClip.entitlements"]) {
    const entitlements = read(path);
    assert.ok(entitlements.includes("<string>appclips:voltresale.app</string>"));
    assert.ok(entitlements.includes("<string>applinks:voltresale.app</string>"));
  }
});

test("the native publishable key and credential domain use the migrated Clerk host", () => {
  const source = read("apps/mobile/ios/Volt/App/AppConfiguration.swift");
  const key = source.match(/clerkPublishableKey = "pk_live_([A-Za-z0-9_-]+)"/)?.[1];
  assert.ok(key, "Missing production Clerk publishable key");
  assert.equal(Buffer.from(key, "base64url").toString("utf8"), "clerk.voltresale.app$");
  const project = read("apps/mobile/ios/Volt.xcodeproj/project.pbxproj");
  const domains = [...project.matchAll(/VOLT_CLERK_FRONTEND_API_DOMAIN = ([^;]+);/g)].map((match) => match[1]);
  assert.deepEqual(domains, ["clerk.voltresale.app", "clerk.voltresale.app"]);
});

test("both public association endpoints describe the full app and App Clip", () => {
  const wellKnown = JSON.parse(read("apps/web/public/.well-known/apple-app-site-association"));
  assert.deepEqual(JSON.parse(read("apps/web/public/apple-app-site-association")), wellKnown);
  assert.ok(wellKnown.appclips.apps.includes("GB5SPLUARQ.com.volt.mobile.Clip"));
  const fullApp = wellKnown.applinks.details.find((entry) => entry.appIDs.includes("GB5SPLUARQ.com.volt.mobile"));
  const clip = wellKnown.applinks.details.find((entry) => entry.appIDs.includes("GB5SPLUARQ.com.volt.mobile.Clip"));
  assert.ok(fullApp.components.some((component) => component["/"] === "/*"));
  assert.ok(clip.components.some((component) => component["/"] === "/clip*"));
  for (const path of ["vercel.json", "apps/web/vercel.json"]) {
    const config = JSON.parse(read(path));
    for (const endpoint of ["/.well-known/apple-app-site-association", "/apple-app-site-association"]) {
      assert.ok(config.rewrites.some((entry) => entry.source === endpoint && entry.destination === endpoint));
      assert.ok(config.headers.some((entry) => entry.source === endpoint && entry.headers.some((header) => header.key === "Content-Type" && header.value === "application/json")));
    }
    assert.ok(config.rewrites.some((entry) => entry.source === "/clip" && entry.destination === "/clip.html"));
  }
});
