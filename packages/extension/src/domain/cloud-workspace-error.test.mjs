import assert from "node:assert/strict";
import test from "node:test";
import { cloudWorkspaceErrorMessage } from "./cloud-workspace-error.ts";

test("cloud workspace authentication and unknown failures do not expose internals", () => {
  assert.equal(
    cloudWorkspaceErrorMessage(
      "you are signed in, but the cloud workspace refused this session.",
    ),
    "Cloud scanner sync could not verify this account. Sign out and back in.",
  );
  assert.equal(
    cloudWorkspaceErrorMessage(new Error("request id and internal stack")),
    "Cloud scanner sync is temporarily unavailable.",
  );
});
