import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./productApiKeyCrypto";
import type {
  ProductApiReservationResult,
  ProductApiSettlementResult,
  ProductApiUsageStatus,
} from "./productApiUsage";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ownerTokenIdentifier = "clerk|api-owner";
const now = 1_800_000_000_000;
const createKey = makeFunctionReference<
  "mutation",
  { name: string },
  { id: Id<"productApiKeys">; token: string }
>("productApiKeys:create");
const getStatus = makeFunctionReference<
  "query",
  Record<string, never>,
  ProductApiUsageStatus
>("productApiUsage:getStatus");
const reserve = makeFunctionReference<
  "mutation",
  { keyHash: string; requestId: string; now: number },
  ProductApiReservationResult
>("productApiUsage:reserve");
const settle = makeFunctionReference<
  "mutation",
  { requestId: string; succeeded: boolean; now: number },
  ProductApiSettlementResult | null
>("productApiUsage:settle");
const cleanup = makeFunctionReference<
  "mutation",
  { now: number },
  { refunded: number }
>("productApiUsage:cleanupExpiredReservations");

function asOwner(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({
    subject: "api-owner",
    tokenIdentifier: ownerTokenIdentifier,
  });
}

async function newKey(
  t: ReturnType<typeof convexTest>,
  name = "Metered client",
) {
  const key = await asOwner(t).mutation(createKey, { name });
  return { ...key, keyHash: await sha256Hex(key.token) };
}

async function seedEvaluationUsage(
  t: ReturnType<typeof convexTest>,
  used: number,
) {
  await t.run(async (ctx) =>
    ctx.db.insert("productApiUsage", {
      ownerTokenIdentifier,
      periodKey: "evaluation",
      used,
      reserved: 0,
      updatedAt: now,
    }),
  );
}

async function seedProduct(
  t: ReturnType<typeof convexTest>,
  upc = "012345678905",
) {
  return t.run(async (ctx) =>
    ctx.db.insert("paymoreCatalogProducts", {
      upc,
      title: "Metered Widget",
      platform: null,
      edition: null,
      collection: null,
      brand: null,
      model: null,
      mpn: null,
      color: null,
      storage: null,
      carrier: null,
      publisher: null,
      genre: null,
      rating: null,
      releaseYear: null,
      attributes: {},
      createdAt: now,
      updatedAt: now,
    }),
  );
}

async function seedSubscription(
  t: ReturnType<typeof convexTest>,
  product: "workspace" | "api",
  paidThrough: number,
) {
  return t.run(async (ctx) =>
    ctx.db.insert("webSubscriptions", {
      ownerClerkUserId: "api-owner",
      ownerTokenIdentifier,
      product,
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: `sub_${product}`,
      status: "active",
      currentPeriodEnd: paidThrough,
      paidThrough,
      cancelAtPeriodEnd: false,
      updatedAt: now,
      lastEventCreated: now,
    }),
  );
}

afterEach(() => vi.unstubAllEnvs());

describe("account product API metering", () => {
  test("requires authentication for the account usage status", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(getStatus, {})).rejects.toThrow("Not authenticated");
  });

  test("instruments successful calls while enforcement is disabled by default", async () => {
    vi.stubEnv("PRODUCT_API_METERING_ENABLED", "false");
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    await seedEvaluationUsage(t, 100);
    expect(
      await t.mutation(reserve, {
        keyHash: key.keyHash,
        requestId: "disabled",
        now,
      }),
    ).toMatchObject({
      kind: "reserved",
      usage: { enforcementEnabled: false, remaining: 0 },
    });
    await t.mutation(settle, {
      requestId: "disabled",
      succeeded: true,
      now: now + 1,
    });
    expect(await asOwner(t).query(getStatus, {})).toMatchObject({
      used: 101,
      reserved: 0,
    });
  });

  test("aggregates keys and reserves the last available slot atomically", async () => {
    vi.stubEnv("PRODUCT_API_METERING_ENABLED", "true");
    const t = convexTest(schema, modules);
    const first = await newKey(t, "First");
    const second = await newKey(t, "Second");
    await seedEvaluationUsage(t, 99);
    const results = await Promise.all([
      t.mutation(reserve, { keyHash: first.keyHash, requestId: "first", now }),
      t.mutation(reserve, {
        keyHash: second.keyHash,
        requestId: "second",
        now,
      }),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual([
      "quota_exceeded",
      "reserved",
    ]);
    expect(await asOwner(t).query(getStatus, {})).toMatchObject({
      used: 99,
      reserved: 1,
      remaining: 0,
    });
    const requestId = results[0].kind === "reserved" ? "first" : "second";
    await t.mutation(settle, { requestId, succeeded: true, now: now + 1 });
    expect(
      await t.mutation(reserve, {
        keyHash: second.keyHash,
        requestId: "third",
        now: now + 2,
      }),
    ).toMatchObject({
      kind: "quota_exceeded",
      usage: { limit: 100, used: 100, reserved: 0 },
    });
  });

  test("reservation and settlement retries do not count twice", async () => {
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    const args = { keyHash: key.keyHash, requestId: "retry", now };
    await t.mutation(reserve, args);
    await t.mutation(reserve, args);
    expect(await asOwner(t).query(getStatus, {})).toMatchObject({
      used: 0,
      reserved: 1,
    });
    await t.mutation(settle, {
      requestId: "retry",
      succeeded: true,
      now: now + 1,
    });
    await t.mutation(settle, {
      requestId: "retry",
      succeeded: true,
      now: now + 2,
    });
    await t.mutation(settle, {
      requestId: "retry",
      succeeded: false,
      now: now + 3,
    });
    expect(await asOwner(t).query(getStatus, {})).toMatchObject({
      used: 1,
      reserved: 0,
    });
  });

  test("refunds failed requests and never resurrects expired reservations", async () => {
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    await t.mutation(reserve, {
      keyHash: key.keyHash,
      requestId: "failed",
      now,
    });
    await t.mutation(settle, {
      requestId: "failed",
      succeeded: false,
      now: now + 1,
    });
    await t.mutation(reserve, {
      keyHash: key.keyHash,
      requestId: "expired",
      now,
    });
    expect(await t.mutation(cleanup, { now: now + 60_000 })).toEqual({
      refunded: 1,
    });
    expect(await t.mutation(cleanup, { now: now + 60_001 })).toEqual({
      refunded: 0,
    });
    expect(
      await t.mutation(settle, {
        requestId: "expired",
        succeeded: true,
        now: now + 60_002,
      }),
    ).toMatchObject({ status: "refunded", usage: { used: 0, reserved: 0 } });
    expect(
      await t.mutation(reserve, {
        keyHash: key.keyHash,
        requestId: "expired",
        now: now + 60_003,
      }),
    ).toMatchObject({ kind: "request_expired" });
  });

  test("late settlement itself refunds a slot even before the cleanup runs", async () => {
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    await t.mutation(reserve, { keyHash: key.keyHash, requestId: "late", now });
    expect(
      await t.mutation(settle, {
        requestId: "late",
        succeeded: true,
        now: now + 60_000,
      }),
    ).toMatchObject({ status: "refunded", usage: { used: 0, reserved: 0 } });
  });

  test("counts a nonempty search response once and a successful item once", async () => {
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    await seedProduct(t);
    await seedProduct(t, "036000291452");
    const headers = { Authorization: `Bearer ${key.token}` };
    const search = await t.fetch("/v1/products?q=Metered", { headers });
    expect(search.status).toBe(200);
    expect(await search.json()).toMatchObject({
      data: [{ upc: "012345678905" }, { upc: "036000291452" }],
    });
    expect(search.headers.get("X-Usage-Used")).toBe("1");
    const item = await t.fetch("/v1/products/012345678905", { headers });
    expect(item.status).toBe(200);
    expect(item.headers.get("X-Usage-Used")).toBe("2");
    expect(item.headers.get("Access-Control-Expose-Headers")).toContain(
      "X-Usage-Remaining",
    );
    expect(await asOwner(t).query(getStatus, {})).toMatchObject({
      used: 2,
      reserved: 0,
    });
  });

  test("invalid requests, missing items, empty searches and invalid cursors do not consume quota", async () => {
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    const headers = { Authorization: `Bearer ${key.token}` };
    for (const [path, status] of [
      ["/v1/products?limit=0", 400],
      ["/v1/products/a/b", 400],
      ["/v1/products/012345678905", 404],
      ["/v1/products?q=Missing", 200],
      ["/v1/products?cursor=not-a-cursor", 400],
    ] as const) {
      expect((await t.fetch(path, { headers })).status).toBe(status);
    }
    expect(await asOwner(t).query(getStatus, {})).toMatchObject({
      used: 0,
      reserved: 0,
    });
    const windows = await t.run(async (ctx) =>
      ctx.db
        .query("productApiRateLimits")
        .withIndex("by_apiKeyId_and_windowStartedAt", (q) =>
          q.eq("apiKeyId", key.id),
        )
        .take(2),
    );
    expect(
      windows.reduce((count, window) => count + window.requestCount, 0),
    ).toBe(5);
  });

  test("preserves server failures and refunds their reservations", async () => {
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    await seedProduct(t);
    await seedProduct(t);
    await expect(
      t.fetch("/v1/products/012345678905", {
        headers: { Authorization: `Bearer ${key.token}` },
      }),
    ).rejects.toThrow();
    expect(await asOwner(t).query(getStatus, {})).toMatchObject({
      used: 0,
      reserved: 0,
    });
  });

  test("rejects quota exhaustion with a stable 429 envelope and usage headers", async () => {
    vi.stubEnv("PRODUCT_API_METERING_ENABLED", "true");
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    await seedEvaluationUsage(t, 100);
    const response = await t.fetch("/v1/products/012345678905", {
      headers: { Authorization: `Bearer ${key.token}` },
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: "quota_exceeded" },
    });
    expect(response.headers.get("X-Usage-Remaining")).toBe("0");
    expect(response.headers.get("X-Usage-Reset")).toBeNull();
  });

  test("workspace payment and disabled commercial access never grant the paid API plan", async () => {
    vi.stubEnv("PRODUCT_API_COMMERCIAL_ENABLED", "true");
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    await seedSubscription(t, "workspace", now + 90 * 86_400_000);
    expect(
      await t.mutation(reserve, {
        keyHash: key.keyHash,
        requestId: "workspace",
        now,
      }),
    ).toMatchObject({ usage: { tier: "evaluation", limit: 100 } });
    await seedSubscription(t, "api", now + 90 * 86_400_000);
    vi.stubEnv("PRODUCT_API_COMMERCIAL_ENABLED", "false");
    expect(
      await t.mutation(reserve, {
        keyHash: key.keyHash,
        requestId: "disabled-paid",
        now,
      }),
    ).toMatchObject({ usage: { tier: "evaluation", limit: 100 } });
  });

  test("requires verified paid coverage rather than a subscription status alone", async () => {
    vi.stubEnv("PRODUCT_API_COMMERCIAL_ENABLED", "true");
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    const subscriptionId = await seedSubscription(t, "api", now + 86_400_000);
    await t.run(async (ctx) =>
      ctx.db.patch(subscriptionId, { paidThrough: undefined }),
    );
    expect(
      await t.mutation(reserve, {
        keyHash: key.keyHash,
        requestId: "unverified",
        now,
      }),
    ).toMatchObject({ usage: { tier: "evaluation", limit: 100 } });
    await t.run(async (ctx) =>
      ctx.db.patch(subscriptionId, { paidThrough: now }),
    );
    expect(
      await t.mutation(reserve, {
        keyHash: key.keyHash,
        requestId: "expired-paid",
        now,
      }),
    ).toMatchObject({ usage: { tier: "evaluation", limit: 100 } });
  });

  test("paid usage caps at 5000 per UTC month, survives renewal, and resets next month", async () => {
    vi.stubEnv("PRODUCT_API_METERING_ENABLED", "true");
    vi.stubEnv("PRODUCT_API_COMMERCIAL_ENABLED", "true");
    const t = convexTest(schema, modules);
    const key = await newKey(t);
    const january = Date.UTC(2027, 0, 31, 23, 59, 59);
    const february = Date.UTC(2027, 1, 1);
    const subscriptionId = await seedSubscription(
      t,
      "api",
      Date.UTC(2027, 2, 1),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("productApiUsage", {
        ownerTokenIdentifier,
        periodKey: "2027-01",
        used: 4999,
        reserved: 0,
        updatedAt: january,
      }),
    );
    expect(
      await t.mutation(reserve, {
        keyHash: key.keyHash,
        requestId: "january-last",
        now: january,
      }),
    ).toMatchObject({
      kind: "reserved",
      usage: { tier: "api", limit: 5000, remaining: 0, resetsAt: february },
    });
    await t.mutation(settle, {
      requestId: "january-last",
      succeeded: true,
      now: january + 1,
    });
    await t.run(async (ctx) =>
      ctx.db.patch(subscriptionId, { paidThrough: Date.UTC(2027, 3, 1) }),
    );
    expect(
      await t.mutation(reserve, {
        keyHash: key.keyHash,
        requestId: "renewed",
        now: january + 2,
      }),
    ).toMatchObject({ kind: "quota_exceeded", usage: { used: 5000 } });
    expect(
      await t.mutation(reserve, {
        keyHash: key.keyHash,
        requestId: "february-first",
        now: february,
      }),
    ).toMatchObject({
      kind: "reserved",
      usage: {
        used: 0,
        reserved: 1,
        remaining: 4999,
        resetsAt: Date.UTC(2027, 2, 1),
      },
    });
  });
});
