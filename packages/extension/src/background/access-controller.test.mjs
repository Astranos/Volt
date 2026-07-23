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

test("Clerk tokens are fetched through the offscreen bridge for each request", async () => {
  const source = await readFile(
    new URL("./access-controller.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /@clerk\/chrome-extension/);
  assert.match(source, /requestClerkToken: \(\) => Promise<string \| null>/);
  assert.match(source, /settleWithin\(requestClerkToken\(\), CLERK_TOKEN_TIMEOUT_MS\)/);
  assert.doesNotMatch(source, /storage\.local\.set\([^)]*(?:jwt|token)/i);
});

test("the DOM-capable offscreen document owns the Clerk background client", async () => {
  const offscreenSource = await readFile(
    new URL("../offscreen/mobile-scanner-offscreen.ts", import.meta.url),
    "utf8",
  );
  const backgroundSource = await readFile(
    new URL("../../entrypoints/background.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    offscreenSource,
    /import \{ createClerkClient \} from "@clerk\/chrome-extension\/client"/,
  );
  assert.match(offscreenSource, /action === "accessOffscreenGetClerkToken"/);
  assert.match(offscreenSource, /background: true/);
  assert.match(offscreenSource, /template: "convex"/);
  assert.match(offscreenSource, /skipCache: true/);
  assert.match(backgroundSource, /action: "accessOffscreenGetClerkToken"/);
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

test("stale anonymous credentials are discarded and reissued", async () => {
  const source = await readFile(
    new URL("./access-controller.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Invalid anonymous trial credentials/);
  assert.match(source, /storage\.local\.remove\(ANONYMOUS_CREDENTIALS_KEY\)/);
  assert.match(source, /includeAnonymous: false/);
});

test("Clerk token refresh allows a normal network round trip", async () => {
  const source = await readFile(
    new URL("./access-controller.ts", import.meta.url),
    "utf8",
  );
  const timeout = source.match(/CLERK_TOKEN_TIMEOUT_MS = ([\d_]+);/)?.[1];
  assert.ok(timeout, "Clerk token timeout must remain explicit");
  assert.ok(Number(timeout.replaceAll("_", "")) >= 10_000);
});
