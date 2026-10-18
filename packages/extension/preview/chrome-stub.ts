// A stand-in for the extension APIs so pages and components render in a plain
// browser tab. Storage is in-memory, runtime messages go to the scenario's
// handlers, and any other API resolves to the scenario's fixture (or undefined).

import packageJson from "../package.json";

type Json = Record<string, unknown>;
type Callback = (value: unknown) => void;

export type ChromeFixture = {
  /** Seeds chrome.storage.local / chrome.storage.sync. */
  storage?: { local?: Json; sync?: Json };
  /** Replies to chrome.runtime.sendMessage, keyed by message `action`. */
  messages?: Record<string, (message: Json) => unknown>;
  /** Results for any other API call, keyed by path, e.g. "bookmarks.getTree". */
  apis?: Record<string, unknown>;
};

function storageArea(initial: Json = {}) {
  const data: Json = structuredClone(initial);
  const pick = (keys: unknown): Json => {
    if (keys == null) return { ...data };
    if (typeof keys === "string") return keys in data ? { [keys]: data[keys] } : {};
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    return Object.fromEntries(Object.entries(keys as Json).map(([key, fallback]) => [key, key in data ? data[key] : fallback]));
  };
  return {
    get: (keys?: unknown, callback?: Callback) => reply(pick(typeof keys === "function" ? null : keys), typeof keys === "function" ? keys as Callback : callback),
    set: (items: Json, callback?: Callback) => { Object.assign(data, items); return reply(undefined, callback); },
    remove: (keys: string | string[], callback?: Callback) => {
      for (const key of [keys].flat()) delete data[key];
      return reply(undefined, callback);
    },
    clear: (callback?: Callback) => { for (const key of Object.keys(data)) delete data[key]; return reply(undefined, callback); },
  };
}

// Extension APIs answer through a callback, a promise, or both.
function reply(value: unknown, callback?: Callback) {
  if (callback) setTimeout(() => callback(value));
  return Promise.resolve(value);
}

const callbackOf = (args: unknown[]) => args.findLast((arg): arg is Callback => typeof arg === "function");

// Installed once, before any app code loads: some modules capture `chrome` at
// import time, so scenarios swap the fixture behind it instead of replacing it.
let fixture: ChromeFixture = {};
const storage = { local: storageArea(), sync: storageArea(), session: storageArea() };

export function setChromeFixture(next: ChromeFixture = {}) {
  fixture = next;
  storage.local = storageArea(next.storage?.local);
  storage.sync = storageArea(next.storage?.sync);
}

export function installChromeStub() {
  const known: Record<string, () => unknown> = {
    "storage.local": () => storage.local,
    "storage.sync": () => storage.sync,
    "storage.session": () => storage.session,
    "runtime.id": () => "volt-preview",
    "runtime.lastError": () => undefined,
    "runtime.getManifest": () => () => ({ manifest_version: 3, name: "Volt", version: packageJson.version }),
    "runtime.getURL": () => (path: string) => new URL(path.replace(/^\/?/, "/"), location.origin).href,
    "runtime.sendMessage": () => (...args: unknown[]) => {
      const message = args.find((arg): arg is Json => !!arg && typeof arg === "object") ?? {};
      const handler = fixture.messages?.[String(message.action)];
      return Promise.resolve(handler?.(message)).then((value) => reply(value, callbackOf(args)));
    },
  };

  const api = (path: string[]): unknown => {
    const call = (...args: unknown[]) => reply(fixture.apis?.[path.join(".")], callbackOf(args));
    return new Proxy(call, {
      get(_, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        const next = [...path, key].join(".");
        return next in known ? known[next]() : api([...path, key]);
      },
    });
  };

  const chrome = api([]);
  Object.assign(globalThis, { chrome, browser: chrome });
}
