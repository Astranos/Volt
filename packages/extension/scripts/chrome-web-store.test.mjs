import assert from "node:assert/strict";
import test from "node:test";

import {
  compareChromeVersions,
  nextPatchVersion,
  nextReleaseVersion,
  parseChromeVersion,
  storeVersions,
} from "./chrome-web-store.mjs";

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
