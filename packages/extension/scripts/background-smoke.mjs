import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

// Boot only: API calls stay pending so account/network initialization cannot
// affect the result. No DOM globals are available in a service worker.
export function verifyBackgroundBoot(source, filename = "background.js") {
  const listeners = new Set();
  const pending = new Promise(() => {});
  const noop = () => {};
  const api = (name) => new Proxy(() => pending, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === "addListener") return () => listeners.add(name);
      if (property === "removeListener") return noop;
      if (name === "chrome.runtime") {
        if (property === "id") return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        if (property === "lastError") return undefined;
        if (property === "getURL") return (pathname) => `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${pathname.replace(/^\//, "")}`;
        if (property === "getManifest") return () => ({ manifest_version: 3, version: "1.0.0" });
      }
      return api(`${name}.${String(property)}`);
    },
  });
  const context = {
    chrome: api("chrome"),
    console: { log: noop, info: noop, warn: noop, error: noop, debug: noop },
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController,
    crypto: globalThis.crypto,
    fetch: () => pending,
    setTimeout: () => 0, clearTimeout: noop,
    setInterval: () => 0, clearInterval: noop,
    queueMicrotask,
    addEventListener: noop,
    removeEventListener: noop,
    navigator: { userAgent: "Chrome extension service worker" },
  };
  context.self = context;
  runInNewContext(source, context, { filename, timeout: 5_000 });
  for (const event of ["chrome.action.onClicked", "chrome.runtime.onMessage"]) {
    if (!listeners.has(event)) throw new Error(`Background did not register ${event}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = process.argv[2] === "-" ? 0 : process.argv[2];
    verifyBackgroundBoot(readFileSync(input, "utf8"), process.argv[3] ?? process.argv[2]);
  } catch (error) {
    console.error(`Background startup smoke check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
