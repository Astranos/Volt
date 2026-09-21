import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { verifyUploadedPhotos } from "./cloudWorkspace/photos";
import schema from "./schema";
import { enroll, modules, putBatch, result } from "./cloudWorkspace.testSupport";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("R2_ACCOUNT_ID", "test-account");
  vi.stubEnv("R2_BUCKET", "test-bucket");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function fakeR2(delayMs: number, byteCount = 10) {
  let active = 0;
  let maxActive = 0;
  let aborted = 0;
  const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal;
    if (!signal) throw new Error("Verification request lacks cancellation");
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        active--;
        aborted++;
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", cancel);
        active--;
        resolve(new Response(null, { headers: { "content-length": String(byteCount) } }));
      }, delayMs);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, active: () => active, maxActive: () => maxActive, aborted: () => aborted };
}

function photos(count: number) {
  return Array.from({ length: count }, (_, index) => ({ objectKey: `photo-${index}`, byteCount: 10 }));
}

test("photo verification limits concurrency and verifies every photo", async () => {
  const r2 = fakeR2(100);
  const verification = verifyUploadedPhotos(photos(9));
  await vi.waitFor(() => expect(r2.fetch).toHaveBeenCalledTimes(4));
  await vi.advanceTimersByTimeAsync(100);
  await vi.waitFor(() => expect(r2.fetch).toHaveBeenCalledTimes(8));
  await vi.advanceTimersByTimeAsync(100);
  await vi.waitFor(() => expect(r2.fetch).toHaveBeenCalledTimes(9));
  await vi.advanceTimersByTimeAsync(100);
  await verification;
  expect(r2.maxActive()).toBe(4);
  expect(r2.active()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("a stalled HEAD cancels peer requests and does not start remaining photos", async () => {
  const r2 = fakeR2(100_000);
  const outcome = verifyUploadedPhotos(photos(12)).catch(error => error);
  await vi.waitFor(() => expect(r2.fetch).toHaveBeenCalledTimes(4));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await outcome).toBeInstanceOf(Error);
  expect(String(await outcome)).toMatch(/timed out/);
  expect(r2.fetch).toHaveBeenCalledTimes(4);
  expect(r2.aborted()).toBe(4);
  expect(r2.active()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("the overall deadline bounds many individually successful slow requests", async () => {
  const r2 = fakeR2(9_000);
  const outcome = verifyUploadedPhotos(photos(100)).catch(error => error);
  await vi.waitFor(() => expect(r2.fetch).toHaveBeenCalledTimes(4));
  for (let wave = 0; wave < 6; wave++) {
    await vi.advanceTimersByTimeAsync(9_000);
    await vi.waitFor(() => expect(r2.fetch).toHaveBeenCalledTimes((wave + 2) * 4));
  }
  await vi.advanceTimersByTimeAsync(6_000);
  expect(String(await outcome)).toMatch(/timed out/);
  expect(r2.fetch).toHaveBeenCalledTimes(28);
  expect(r2.aborted()).toBe(4);
  expect(r2.active()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("failed verification leaves a batch uploading; a successful retry marks it ready", async () => {
  const t = convexTest(schema, modules);
  const owner = await enroll(t, "photo-finalize-owner");
  await t.mutation(putBatch, {
    ...owner.credential, batchId: "photo-batch", clientCreatedAt: 1, results: [result("photo", "photo")],
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { headers: { "content-length": "11" } })));
  await expect(t.action(api.cloudWorkspace.finalizeBatchUploads, { ...owner.credential, batchId: "photo-batch" }))
    .rejects.toThrow(/verification failed/);
  expect(await t.run(ctx => ctx.db.query("resultBatches").unique())).toMatchObject({ status: "uploading" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { headers: { "content-length": "10" } })));
  await t.action(api.cloudWorkspace.finalizeBatchUploads, { ...owner.credential, batchId: "photo-batch" });
  expect(await t.run(ctx => ctx.db.query("resultBatches").unique())).toMatchObject({ status: "ready" });
  expect(vi.getTimerCount()).toBe(0);
});
