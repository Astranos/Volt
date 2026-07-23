import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isTrustedExtensionPageSender } from "../access/sender-policy.ts";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

test("scanner access messages accept only allowlisted internal pages", () => {
  assert.equal(
    isTrustedExtensionPageSender(
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/offscreen.html`,
      },
      EXTENSION_ID,
      ["/offscreen.html"],
    ),
    true,
  );
  assert.equal(
    isTrustedExtensionPageSender(
      {
        id: EXTENSION_ID,
        url: `chrome-extension://${EXTENSION_ID}/sidepanel.html`,
      },
      EXTENSION_ID,
      ["/offscreen.html"],
    ),
    false,
  );
});

test("content-script and foreign-extension join requests are rejected", () => {
  assert.equal(
    isTrustedExtensionPageSender(
      { id: EXTENSION_ID, url: "https://marketplace.example/listing" },
      EXTENSION_ID,
      ["/offscreen.html"],
    ),
    false,
  );
  assert.equal(
    isTrustedExtensionPageSender(
      {
        id: "different-extension-id",
        url: `chrome-extension://${EXTENSION_ID}/offscreen.html`,
      },
      EXTENSION_ID,
      ["/offscreen.html"],
    ),
    false,
  );
});

test("Clerk tokens stay in the service worker and are fetched for each request", async () => {
  const source = await readFile(
    new URL("./access-controller.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /createClerkClient\(\{[\s\S]*background: true/);
  assert.match(source, /async function freshClerkClient\(\)/);
  assert.doesNotMatch(source, /clerkClientPromise/);
  assert.match(
    source,
    /session\?\.getToken\(\{[\s\S]*template: "convex"[\s\S]*organizationId:/,
  );
  assert.doesNotMatch(source, /storage\.local\.set\([^)]*(?:jwt|token)/i);
});

test("anonymous credentials are accepted only from server issuance", async () => {
  const source = await readFile(
    new URL("./access-controller.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /includeAnonymous: Boolean\(existing\)/);
  assert.match(source, /record\?\.anonymousId/);
  assert.match(source, /record\?\.anonymousSecret/);
  assert.doesNotMatch(source, /function randomSecret/);
});
