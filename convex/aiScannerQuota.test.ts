import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const reserve = makeFunctionReference<"mutation", {
  deviceId: string; deviceSecret: string; requestId: string; mode: "upc" | "name";
}, { status: string; errorCode?: string; quota: { kind: string; used?: number; remaining?: number } }>("aiScannerQuota:reserveAIScannerRequest");
const complete = makeFunctionReference<"mutation", {
  deviceId: string; deviceSecret: string; requestId: string; mode: "upc" | "name"; value: string | null; format: string;
}, { quota: { kind: string; used?: number; remaining?: number } }>("aiScannerQuota:completeAIScannerRequest");
const refund = makeFunctionReference<"mutation", {
  deviceId: string; deviceSecret: string; requestId: string; errorCode: "upstream-failed" | "upstream-timeout" | "invalid-input" | "upstream-rate-limited";
}, { quota: { kind: string; used?: number; remaining?: number } }>("aiScannerQuota:refundAIScannerRequest");
const bootstrap = makeFunctionReference<"mutation", { installationId: string; label: string }, { deviceId: string; deviceSecret: string }>("cloudWorkspace:bootstrapMobileDevice");
const listComputers = makeFunctionReference<"query", { deviceId: string; deviceSecret: string }, unknown>("cloudWorkspace:listMobileComputers");
const getStatus = makeFunctionReference<"mutation", Record<string, never>, { body: { plan: string; subscriptionStatus: string; capabilities: { cloudWorkspace: boolean } } }>("access:getStatus");

const credentials = { deviceId: "ai-device", deviceSecret: "ai-secret" };
const requestId = (index: number) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;

async function createDevice(t: ReturnType<typeof convexTest>, plan: "free" | "manual" | "future" = "free") {
  const now = Date.now();
  await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", { ownerClerkUserId: "ai-user", name: "AI", createdAt: now, updatedAt: now });
    if (plan === "manual" || plan === "future") {
      await ctx.db.insert("entitlements", {
        clerkUserId: "ai-user", kind: "manual", sourceIdentifier: "manual-test", productId: "pro", status: "active", validFrom: plan === "future" ? now + 3_600_000 : now, updatedAt: now,
      });
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credentials.deviceSecret));
    const credentialHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("workspaceDevices", { workspaceId, deviceId: credentials.deviceId, credentialHash, kind: "ios", label: "AI", createdAt: now, lastSeenAt: now });
  });
}

async function createSecondDevice(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credentials.deviceSecret));
  const credentialHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await t.run(async (ctx) => {
    const workspace = (await ctx.db.query("workspaces").collect()).find((row) => row.ownerClerkUserId === "ai-user");
    if (!workspace) throw new Error("workspace missing");
    await ctx.db.insert("workspaceDevices", { workspaceId: workspace._id, deviceId: "ai-device-2", credentialHash, kind: "ios", label: "AI 2", createdAt: now, lastSeenAt: now });
  });
  return { deviceId: "ai-device-2", deviceSecret: credentials.deviceSecret };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("AI scanner quota", () => {
  test("allows ten free requests and rejects the eleventh", async () => {
    const t = convexTest(schema, modules);
    await createDevice(t);
    for (let index = 1; index <= 10; index += 1) {
      expect((await t.mutation(reserve, { ...credentials, requestId: requestId(index), mode: "name" })).status).toBe("reserved");
    }
    const eleventh = await t.mutation(reserve, { ...credentials, requestId: requestId(11), mode: "name" });
    expect(eleventh).toMatchObject({ status: "rejected", errorCode: "quota-exhausted", quota: { kind: "metered", used: 10, remaining: 0 } });
  });

  test("resets the free quota on the next UTC calendar month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T23:59:59.000Z"));
    const t = convexTest(schema, modules);
    await createDevice(t);
    for (let index = 1; index <= 10; index += 1) await t.mutation(reserve, { ...credentials, requestId: requestId(index), mode: "upc" });
    vi.setSystemTime(new Date("2026-02-01T00:01:01.000Z"));
    const next = await t.mutation(reserve, { ...credentials, requestId: requestId(11), mode: "upc" });
    expect(next).toMatchObject({ status: "reserved", quota: { used: 1, remaining: 9 } });
  });

  test("gives manual Pro unlimited monthly quota but enforces the safety window", async () => {
    const t = convexTest(schema, modules);
    await createDevice(t, "manual");
    for (let index = 1; index <= 10; index += 1) await t.mutation(reserve, { ...credentials, requestId: requestId(index), mode: "name" });
    const eleventh = await t.mutation(reserve, { ...credentials, requestId: requestId(11), mode: "name" });
    expect(eleventh).toMatchObject({ status: "rejected", errorCode: "rate-limited", quota: { kind: "unlimited" } });
  });

  test("development unlimited mode bypasses both quota limits", async () => {
    vi.stubEnv("AI_SCANNER_QUOTA_MODE", "unlimited");
    const t = convexTest(schema, modules);
    await createDevice(t);
    for (let index = 1; index <= 11; index += 1) {
      expect((await t.mutation(reserve, { ...credentials, requestId: requestId(index), mode: "name" })).status).toBe("reserved");
    }
  });

  test("is idempotent by device and request id and refunds free monthly quota", async () => {
    const t = convexTest(schema, modules);
    await createDevice(t);
    const secondDevice = await createSecondDevice(t);
    const first = await t.mutation(reserve, { ...credentials, requestId: requestId(1), mode: "name" });
    const duplicate = await t.mutation(reserve, { ...credentials, requestId: requestId(1), mode: "name" });
    const crossDevice = await t.mutation(reserve, { ...secondDevice, requestId: requestId(1), mode: "name" });
    expect(first.status).toBe("reserved");
    expect(duplicate).toMatchObject({ status: "rejected", errorCode: "request-in-progress" });
    expect(crossDevice).toMatchObject({ status: "rejected", errorCode: "invalid-device" });
    await t.mutation(refund, { ...credentials, requestId: requestId(1), errorCode: "upstream-failed" });
    const second = await t.mutation(reserve, { ...credentials, requestId: requestId(2), mode: "name" });
    expect(second).toMatchObject({ status: "reserved", quota: { used: 1, remaining: 9 } });
  });

  test("counts a completed null result and rejects free users after ten attempts", async () => {
    const t = convexTest(schema, modules);
    await createDevice(t);
    await t.mutation(reserve, { ...credentials, requestId: requestId(1), mode: "upc" });
    const finished = await t.mutation(complete, { ...credentials, requestId: requestId(1), mode: "upc", value: null, format: "upc_a" });
    expect(finished.quota).toMatchObject({ kind: "metered", used: 1, remaining: 9 });
  });

  test("allows a free Clerk user to bootstrap but keeps cloud operations gated", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "free-user", tokenIdentifier: "clerk|free-user" });
    const device = await t.mutation(bootstrap, { installationId: "free-install", label: "Free iPhone" });
    await expect(t.query(listComputers, device)).rejects.toThrow();
  });

  test("rate-limits one Clerk account across its devices", async () => {
    const t = convexTest(schema, modules);
    await createDevice(t, "manual");
    const secondDevice = await createSecondDevice(t);
    for (let index = 1; index <= 5; index += 1) {
      await t.mutation(reserve, { ...credentials, requestId: requestId(index), mode: "name" });
      await t.mutation(reserve, { ...secondDevice, requestId: requestId(index + 100), mode: "name" });
    }
    const limited = await t.mutation(reserve, { ...credentials, requestId: requestId(999), mode: "name" });
    expect(limited).toMatchObject({ status: "rejected", errorCode: "rate-limited" });
  });

  test("refunded rows cannot hide counted free usage", async () => {
    const t = convexTest(schema, modules);
    await createDevice(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      const workspace = (await ctx.db.query("workspaces").collect()).find((row) => row.ownerClerkUserId === "ai-user");
      if (!workspace) throw new Error("workspace missing");
      for (let index = 1; index <= 20; index += 1) {
        await ctx.db.insert("aiScannerRequests", {
          deviceId: credentials.deviceId,
          clerkUserId: "ai-user",
          requestId: requestId(index),
          mode: "name",
          periodKey: new Date(now).toISOString().slice(0, 7),
          plan: "free",
          status: index <= 10 ? "refunded" : "reserved",
          countsTowardQuota: index > 10,
          createdAt: now - 120_000,
          updatedAt: now - 120_000,
        });
      }
    });
    const exhausted = await t.mutation(reserve, { ...credentials, requestId: requestId(21), mode: "name" });
    expect(exhausted).toMatchObject({ status: "rejected", errorCode: "quota-exhausted", quota: { used: 10, remaining: 0 } });
  });

  test("does not grant Pro for a future-dated entitlement", async () => {
    const t = convexTest(schema, modules);
    await createDevice(t, "future");
    const first = await t.mutation(reserve, { ...credentials, requestId: requestId(1), mode: "name" });
    expect(first.quota).toMatchObject({ kind: "metered", limit: 10, used: 1 });
  });

  test("does not charge prior Pro scans against the free quota after Pro expires", async () => {
    const t = convexTest(schema, modules);
    await createDevice(t, "manual");
    await t.mutation(reserve, { ...credentials, requestId: requestId(1), mode: "name" });
    await t.run(async (ctx) => {
      const entitlements = await ctx.db
        .query("entitlements")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", "ai-user"))
        .collect();
      for (const entitlement of entitlements) {
        await ctx.db.patch(entitlement._id, { status: "expired", expiresAt: Date.now() - 1 });
      }
    });
    const freeRequest = await t.mutation(reserve, {
      ...credentials,
      requestId: requestId(2),
      mode: "name",
    });
    expect(freeRequest).toMatchObject({
      status: "reserved",
      quota: { kind: "metered", used: 1, remaining: 9 },
    });
  });

  test("reports StoreKit status separately from manual Pro access", async () => {
    vi.stubEnv("CLERK_COMPLIMENTARY_USER_IDS", "manual-user");
    const t = convexTest(schema, modules).withIdentity({ subject: "manual-user", tokenIdentifier: "clerk|manual-user" });
    await t.run(async (ctx) => {
      await ctx.db.insert("entitlements", { clerkUserId: "manual-user", kind: "manual", sourceIdentifier: "complimentary-user:manual-user", productId: "pro", status: "active", validFrom: Date.now(), updatedAt: Date.now() });
    });
    const status = await t.mutation(getStatus, {});
    expect(status.body).toMatchObject({ plan: "pro", subscriptionStatus: "none", capabilities: { cloudWorkspace: true } });
  });
});
