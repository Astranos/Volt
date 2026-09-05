import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const publicDirectory = new URL("../apps/web/public/", import.meta.url);
const workerSource = await readFile(new URL("sw.js", publicDirectory), "utf8");

function worker({ offline = false, missingFallback = false } = {}) {
  const events = new Map();
  const writes = [];
  const removed = [];
  const networkCalls = [];
  const cachedPage = new Response("Reconnect to Volt");
  const cache = {
    add: async (request) => { writes.push(request.url); },
    match: async (path) => {
      assert.equal(path, "/offline.html");
      return missingFallback ? undefined : cachedPage;
    },
  };
  runInNewContext(workerSource, {
    URL,
    Response,
    Request: class extends Request {
      constructor(url, options) { super(new URL(url, "https://volt.test"), options); }
    },
    self: {
      location: { origin: "https://volt.test" },
      clients: { claim: async () => {} },
      addEventListener: (name, callback) => events.set(name, callback),
    },
    caches: {
      open: async () => cache,
      keys: async () => ["volt-offline-v0", "volt-offline-v1", "unrelated-cache"],
      delete: async (key) => { removed.push(key); },
    },
    fetch: async (request) => {
      networkCalls.push(request.url);
      if (offline) throw new TypeError("Network unavailable");
      return new Response("Private workspace response");
    },
  });
  return {
    writes,
    removed,
    networkCalls,
    async lifecycle(name) {
      let pending;
      events.get(name)({ waitUntil: (promise) => { pending = promise; } });
      await pending;
    },
    request(overrides = {}) {
      let response;
      events.get("fetch")({
        request: { url: "https://volt.test/dashboard", method: "GET", mode: "navigate", ...overrides },
        respondWith: (promise) => { response = promise; },
      });
      return response;
    },
  };
}

test("installation caches only the public offline page", async () => {
  const instance = worker();
  await instance.lifecycle("install");
  assert.deepEqual(instance.writes, ["https://volt.test/offline.html"]);
});

test("activation removes only obsolete Volt offline caches", async () => {
  const instance = worker();
  await instance.lifecycle("activate");
  assert.deepEqual(instance.removed, ["volt-offline-v0"]);
});

test("online navigations fetch fresh responses without storing account content", async () => {
  const instance = worker();
  assert.equal(await (await instance.request()).text(), "Private workspace response");
  assert.deepEqual(instance.writes, []);
  assert.deepEqual(instance.networkCalls, ["https://volt.test/dashboard"]);
});

test("failed navigations return the public reconnect page", async () => {
  const instance = worker({ offline: true });
  assert.equal(await (await instance.request()).text(), "Reconnect to Volt");
  assert.deepEqual(instance.writes, []);
});

test("missing offline cache still returns an honest 503", async () => {
  const response = await worker({ offline: true, missingFallback: true }).request();
  assert.equal(response.status, 503);
  assert.match(await response.text(), /internet connection/);
});

test("API, cross-origin, non-GET, auth fetches and photos bypass the worker", () => {
  const instance = worker({ offline: true });
  for (const request of [
    { url: "https://volt.test/api/keys" },
    { url: "https://volt.test/api" },
    { url: "https://accounts.example.test/sign-in" },
    { method: "POST" },
    { mode: "cors", url: "https://volt.test/auth/session" },
    { mode: "no-cors", url: "https://volt.test/private-photo.jpg" },
  ]) assert.equal(instance.request(request), undefined);
  assert.deepEqual(instance.writes, []);
  assert.deepEqual(instance.networkCalls, []);
});

test("manifest starts in the dashboard with real 192 and 512 pixel icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", publicDirectory), "utf8"));
  assert.equal(manifest.start_url, "/dashboard");
  assert.equal(manifest.display, "standalone");
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}`);
    assert.ok(icon);
    const png = await readFile(new URL(icon.src.slice(1), publicDirectory));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
