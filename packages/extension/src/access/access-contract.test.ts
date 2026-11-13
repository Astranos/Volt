import { describe, expect, test } from "vitest";

import { ACCESS_KINDS, parseExtensionAccessStatus } from "./access-contract";

const status = {
  isAuthorized: true,
  freeSessionsRemaining: 5,
  requiresSignIn: false,
  requiresSubscription: false,
  subscriptionStatus: "none",
  productId: "com.volt.mobile.pro.monthly",
};

describe("access status compatibility", () => {
  test.each(ACCESS_KINDS)("accepts current access value %s", (access) => {
    expect(parseExtensionAccessStatus({ ...status, access })).toMatchObject({ ...status, access });
  });

  test("normalizes the retired value in cached payloads without a subscription", () => {
    expect(parseExtensionAccessStatus({ ...status, access: "complimentary" })).toMatchObject({
      access: "trial",
      isAuthorized: true,
      requiresSubscription: false,
      subscriptionStatus: "none",
    });
  });

  test("rejects unknown access values and malformed payloads", () => {
    expect(parseExtensionAccessStatus({ ...status, access: "unknown" })).toBeNull();
    expect(parseExtensionAccessStatus(null)).toBeNull();
  });
});
