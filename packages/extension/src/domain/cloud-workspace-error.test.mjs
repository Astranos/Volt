import assert from "node:assert/strict";
import test from "node:test";
import { cloudWorkspaceErrorMessage } from "./cloud-workspace-error.ts";

test("cloud workspace entitlement failures are concise and account-specific", () => {
  const error = new Error(
    "[CONVEX Q(cloudWorkspace:workspaceSnapshot)] Server Error Uncaught ConvexError: Volt Pro subscription or complimentary access required at requireFullAppEntitlement (../convex/cloudWorkspace.ts:123:0)",
  );

  assert.equal(
    cloudWorkspaceErrorMessage(error),
    "Cloud scanner sync requires Volt Pro or complimentary access for this account.",
  );
});

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
