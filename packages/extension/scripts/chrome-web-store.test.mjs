import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyBackgroundBoot } from "./background-smoke.mjs";

import {
  chromeExtensionIdFromPublicKey,
  compareChromeVersions,
  nextPatchVersion,
  nextReleaseVersion,
  parseChromeVersion,
  parseOptions,
  parseSubmitExistingDraftOptions,
  storeVersions,
  submitExistingDraft,
  validateProductionBuildEnv,
} from "./chrome-web-store.mjs";

const registeredWorker = `
  chrome.action.onClicked.addListener(() => {});
  chrome.runtime.onMessage.addListener(() => {});
`;

test("release smoke check boots a worker without waiting for storage/network", () => {
  verifyBackgroundBoot(`
    chrome.storage.local.get("account").then(() => fetch("https://example.com"));
    ${registeredWorker}
  `);
});

test("release smoke check rejects bundled UI initialization even after listeners register", () => {
  assert.throws(() => verifyBackgroundBoot(`
    ${registeredWorker}
    document.querySelector("style#cl-style-insertion-point");
  `), /document is not defined/);
});

test("release smoke check requires both toolbar and runtime message handlers", () => {
  assert.throws(() => verifyBackgroundBoot(""), /chrome.action.onClicked/);
  assert.throws(() => verifyBackgroundBoot("chrome.action.onClicked.addListener(() => {});"), /chrome.runtime.onMessage/);
});

test("release smoke subprocess rejects asynchronous module startup failures", () => {
  const result = spawnSync(process.execPath, [
    "--unhandled-rejections=strict",
    fileURLToPath(new URL("./background-smoke.mjs", import.meta.url)),
    "-", "background.js",
  ], { encoding: "utf8", input: `${registeredWorker} Promise.resolve().then(() => document.querySelector('style'));` });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /document is not defined/);
});

test("parses and pads valid Chrome versions", () => {
  assert.deepEqual(parseChromeVersion("1.2.3"), [1, 2, 3, 0]);
  assert.deepEqual(parseChromeVersion("3.1.2.4567"), [3, 1, 2, 4567]);
});

test("rejects invalid Chrome versions", () => {
  for (const version of ["0.0.0", "01.2.3", "1.2.3.4.5", "1.2.65536"]) {
    assert.throws(() => parseChromeVersion(version));
  }
});

test("compares missing version components as zero", () => {
  assert.equal(compareChromeVersions("1.1", "1.1.0.0"), 0);
  assert.ok(compareChromeVersions("1.2", "1.1.9999.9999") > 0);
});

test("uses the source version as a floor and bumps above the store", () => {
  assert.equal(nextReleaseVersion("1.0.56", ["1.0.55"]), "1.0.56");
  assert.equal(nextReleaseVersion("1.0.56", ["1.0.56"]), "1.0.57");
  assert.equal(nextReleaseVersion("1.0.56", ["1.0.57.9"]), "1.0.58");
});

test("rolls over Chrome version component limits", () => {
  assert.equal(nextPatchVersion(["1.2.65535"]), "1.3.0");
  assert.equal(nextPatchVersion(["1.65535.65535"]), "2.0.0");
});

test("extracts published and submitted store versions", () => {
  assert.deepEqual(
    storeVersions({
      publishedItemRevisionStatus: {
        distributionChannels: [{ crxVersion: "1.0.55" }],
      },
      submittedItemRevisionStatus: {
        distributionChannels: [{ crxVersion: "1.0.56" }],
      },
    }),
    ["1.0.55", "1.0.56"],
  );
});

test("pending reviews are replaced only when explicitly requested", () => {
  assert.equal(parseOptions([]).replacePending, false);
  assert.equal(parseOptions(["--replace-pending"]).replacePending, true);
});

test("submits an existing draft with default publishing behavior", async () => {
  const calls = [];
  const options = parseSubmitExistingDraftOptions([]);
  const result = await submitExistingDraft(
    "publishers/publisher/items/extension",
    "token",
    options,
    async (...args) => {
      calls.push(args);
      return { state: "PENDING_REVIEW" };
    },
  );

  assert.deepEqual(options, {
    publishType: "DEFAULT_PUBLISH",
    skipReview: false,
  });
  assert.deepEqual(calls, [
    [
      "publishers/publisher/items/extension",
      "token",
      {
        publishType: "DEFAULT_PUBLISH",
        skipReview: false,
      },
    ],
  ]);
  assert.deepEqual(result, { state: "PENDING_REVIEW" });
});

test("supports staged publishing and rejects release-only draft options", () => {
  assert.deepEqual(
    parseSubmitExistingDraftOptions([
      "--publish-type=STAGED_PUBLISH",
      "--skip-review",
    ]),
    {
      publishType: "STAGED_PUBLISH",
      skipReview: true,
    },
  );
  assert.throws(
    () => parseSubmitExistingDraftOptions(["--upload-only"]),
    /Unsupported submit-existing-draft option: --upload-only/,
  );
  assert.throws(
    () => parseSubmitExistingDraftOptions(["--replace-pending"]),
    /Unsupported submit-existing-draft option: --replace-pending/,
  );
});

test("validates production Clerk config and stable extension identity", () => {
  const extensionPublicKey = Buffer.from("volt-extension-public-key").toString("base64");
  const extensionId = chromeExtensionIdFromPublicKey(extensionPublicKey);

  assert.deepEqual(
    validateProductionBuildEnv({
      CWS_EXTENSION_ID: extensionId,
      WXT_CLERK_PUBLISHABLE_KEY: "pk_live_example",
      WXT_EXTENSION_PUBLIC_KEY: extensionPublicKey,
    }),
    {
      clerkPublishableKey: "pk_live_example",
      extensionId,
      extensionPublicKey,
    },
  );
});

test("rejects missing, test, and mismatched production auth config", () => {
  const extensionPublicKey = Buffer.from("volt-extension-public-key").toString("base64");

  assert.throws(
    () => validateProductionBuildEnv({}),
    /Clerk production publishable key/,
  );
  assert.throws(
    () =>
      validateProductionBuildEnv({
        WXT_CLERK_PUBLISHABLE_KEY: "pk_test_example",
        WXT_EXTENSION_PUBLIC_KEY: extensionPublicKey,
      }),
    /Clerk production publishable key/,
  );
  assert.throws(
    () =>
      validateProductionBuildEnv({
        CWS_EXTENSION_ID: "a".repeat(32),
        WXT_CLERK_PUBLISHABLE_KEY: "pk_live_example",
        WXT_EXTENSION_PUBLIC_KEY: extensionPublicKey,
      }),
    /expected a{32}/,
  );
});
