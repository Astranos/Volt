import { convexTest } from "convex-test";
import { makeFunctionReference, type ApiFromModules, type FunctionArgs, type FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import type * as functions from "./kioskRequests";

const modules = import.meta.glob("./**/*.ts");
type References = ApiFromModules<{ kioskRequests: typeof functions }>["kioskRequests"];
const enqueue = makeFunctionReference<"mutation", FunctionArgs<References["enqueue"]>, FunctionReturnType<References["enqueue"]>>("kioskRequests:enqueue");
const list = makeFunctionReference<"query", FunctionArgs<References["list"]>, FunctionReturnType<References["list"]>>("kioskRequests:list");
const setStatus = makeFunctionReference<"mutation", FunctionArgs<References["setStatus"]>, FunctionReturnType<References["setStatus"]>>("kioskRequests:setStatus");
const expire = makeFunctionReference<"mutation", FunctionArgs<References["expire"]>, null>("kioskRequests:expire");
const secret = "test-only-secret-000000000000000000000000";
const access = { secret, storeSlug: "taylormi" };
const listAccess = () => ({ ...access, now: Date.now() });
function input(index = 1, visitor = 1, storeSlug = "taylormi") {
  return {
    secret, storeSlug, requestKey: `00000000-0000-4000-8000-${visitor.toString().padStart(12, "0")}:${index}`,
    clientHash: visitor.toString(16).padStart(64, "0"),
    product: { productId: `${index}`, variantId: `${index}`, title: "Camera", variantTitle: "Default Title", sku: "MI01-8773A-E9", imageUrl: "https://cdn.shopify.com/test.jpg", priceCents: 999, productUrl: `https://${storeSlug}.paymore.com/products/camera` },
  };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); vi.stubEnv("KIOSK_REQUEST_SECRET", secret); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

test("deduplicates retries, keeps expiry fixed and never exposes private fields", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(enqueue, input());
  vi.setSystemTime(Date.now() + 10_000);
  expect(await t.mutation(enqueue, input())).toEqual(first);
  expect(first.expiresAt - first.createdAt).toBe(3_600_000);
  const result = await t.query(list, listAccess());
  expect(result.requests).toHaveLength(1);
  expect(result.requests[0]).toMatchObject({ sku: "MI01-8773A-E9", id: first.id });
  expect(result.requests[0]).not.toHaveProperty("clientHash");
  expect(result.requests[0]).not.toHaveProperty("requestKey");
  await expect(t.mutation(enqueue, { ...input(), product: { ...input().product, productId: "2" } })).rejects.toThrow("CONFLICT");
});

test("isolates stores for queue, dedup and updates", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(enqueue, input());
  const second = await t.mutation(enqueue, input(1, 1, "southfieldmi"));
  expect(first.id).not.toBe(second.id);
  expect((await t.query(list, listAccess())).requests.map(row => row.id)).toEqual([first.id]);
  expect(await t.mutation(setStatus, { ...access, storeSlug: "southfieldmi", id: first.id, status: "given" })).toBeNull();
});

test("found remains active; terminal states cannot reopen and retry stays deduplicated", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(enqueue, input());
  vi.setSystemTime(Date.now() + 1000);
  const found = await t.mutation(setStatus, { ...access, id: first.id, status: "found" });
  expect(found?.expiresAt).toBe(first.expiresAt);
  expect((await t.query(list, listAccess())).requests).toHaveLength(1);
  await t.mutation(setStatus, { ...access, id: first.id, status: "shown" });
  expect((await t.query(list, listAccess())).requests).toHaveLength(0);
  expect((await t.mutation(enqueue, input())).status).toBe("shown");
  await expect(t.mutation(setStatus, { ...access, id: first.id, status: "found" })).rejects.toThrow("CONFLICT");
  expect((await t.mutation(setStatus, { ...access, id: first.id, status: "shown" }))?.status).toBe("shown");
});

test("expires at one hour before cleanup and scheduled deletion is idempotent", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(enqueue, input());
  await t.mutation(expire, { id: first.id });
  expect((await t.query(list, listAccess())).requests).toHaveLength(1);
  vi.setSystemTime(first.expiresAt);
  expect((await t.query(list, listAccess())).requests).toHaveLength(0);
  await expect(t.mutation(enqueue, input())).rejects.toThrow("CONFLICT");
  expect(await t.mutation(setStatus, { ...access, id: first.id, status: "found" })).toBeNull();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run(ctx => ctx.db.get(first.id))).toBeNull();
  expect(await t.mutation(expire, { id: first.id })).toBeNull();
});

test("rejects missing configuration and forged secrets on all public operations", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(enqueue, input());
  await expect(t.query(list, { ...listAccess(), secret: "wrong" })).rejects.toThrow("UNAUTHORIZED");
  await expect(t.mutation(enqueue, { ...input(), secret: "wrong" })).rejects.toThrow("UNAUTHORIZED");
  await expect(t.mutation(setStatus, { ...access, secret: "wrong", id: first.id, status: "given" })).rejects.toThrow("UNAUTHORIZED");
  vi.stubEnv("KIOSK_REQUEST_SECRET", "");
  await expect(t.query(list, listAccess())).rejects.toThrow("UNAUTHORIZED");
});

test("limits visitor requests to five per minute including completed rows", async () => {
  const t = convexTest(schema, modules);
  for (let index = 1; index <= 5; index++) {
    const row = await t.mutation(enqueue, input(index));
    await t.mutation(setStatus, { ...access, id: row.id, status: "cleared" });
  }
  await expect(t.mutation(enqueue, input(6))).rejects.toThrow("RATE_LIMITED");
  expect((await t.mutation(enqueue, input(1))).status).toBe("cleared");
  vi.setSystemTime(Date.now() + 60_001);
  expect((await t.mutation(enqueue, input(6))).status).toBe("waiting");
});

test("limits store to thirty per minute separately from visitor limit", async () => {
  const t = convexTest(schema, modules);
  for (let index = 1; index <= 30; index++) await t.mutation(enqueue, input(index, index));
  await expect(t.mutation(enqueue, input(31, 31))).rejects.toThrow("RATE_LIMITED");
  expect((await t.mutation(enqueue, input(31, 31, "southfieldmi"))).status).toBe("waiting");
});

test("caps active queue at one hundred and returns oldest first", async () => {
  const t = convexTest(schema, modules);
  for (let index = 1; index <= 100; index++) {
    await t.mutation(enqueue, input(index, index));
    vi.setSystemTime(Date.now() + 3000);
  }
  const rows = (await t.query(list, listAccess())).requests;
  expect(rows).toHaveLength(100);
  expect(rows.map(row => row.productId)).toEqual(Array.from({ length: 100 }, (_, i) => `${i + 1}`));
  await expect(t.mutation(enqueue, input(101, 101))).rejects.toThrow("QUEUE_FULL");
});

test.each([
  { imageUrl: "https://evil.example/image.png" }, { productUrl: "https://southfieldmi.paymore.com/products/camera" },
  { priceCents: -1 }, { priceCents: 1.5 }, { title: "" }, { productId: "not-an-id" },
])("rejects invalid snapshots %j", async product => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(enqueue, { ...input(), product: { ...input().product, ...product } })).rejects.toThrow("INVALID_INPUT");
});

test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid server timestamps %s", async now => {
  const t = convexTest(schema, modules);
  await expect(t.query(list, { ...access, now })).rejects.toThrow("INVALID_INPUT");
});

test("uses supplied server time for expiry and response", async () => {
  const t = convexTest(schema, modules);
  const row = await t.mutation(enqueue, input());
  expect((await t.query(list, { ...access, now: row.expiresAt - 1 })).requests).toHaveLength(1);
  expect(await t.query(list, { ...access, now: row.expiresAt })).toEqual({ requests: [], serverNow: row.expiresAt });
});
