import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("free cloud workspace capability", () => {
  test("signed-in free accounts can sync without a paid entitlement", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "user_free_workspace" });

    const response = await signedIn.mutation(api.access.getStatus, {});

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      clerkUserId: "user_free_workspace",
      plan: "free",
      subscriptionStatus: "none",
      hasFullAppAccess: false,
      capabilities: { localCapture: true, cloudWorkspace: true, aiProductScanner: true },
      aiScannerQuota: { kind: "metered", remaining: 10 },
    });
  });

  test("exhausting legacy session trials does not remove signed-in cloud access", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "user_old_trial" });
    await signedIn.mutation(api.access.getStatus, {});
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", "user_old_trial"))
        .unique();
      if (!user) throw new Error("Expected initialized account");
      await ctx.db.patch(user._id, { freeSessionsConsumed: 5 });
    });

    const response = await signedIn.mutation(api.access.getStatus, {});

    expect(response.body).toMatchObject({
      plan: "free",
      capabilities: { cloudWorkspace: true },
      freeSessionsRemaining: 0,
    });
    await expect(signedIn.mutation(api.cloudWorkspace.ensureWorkspace, {})).resolves.toMatchObject({
      ownerClerkUserId: "user_old_trial",
    });
  });

  test("anonymous legacy trials do not receive account cloud access", async () => {
    const t = convexTest(schema, modules);

    const response = await t.mutation(api.access.anonymousTrial, {});

    expect(response.body).toMatchObject({
      plan: "free",
      capabilities: { localCapture: true, cloudWorkspace: false },
    });
  });
});
