import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ocrFlagInputFrom, OCR_FLAG_MAX_PER_HOUR } from "./ocrFlags";
import schema from "./schema";
import { enroll, modules } from "./cloudWorkspace.testSupport";

const listOcrFlags = makeFunctionReference<"query", { limit?: number }, Array<{ flagId: string; selectedRawText: string; regions: unknown[] }>>(
  "ocrFlags:listOcrFlags",
);

beforeEach(() => {
  vi.stubEnv("R2_ACCOUNT_ID", "test-account");
  vi.stubEnv("R2_BUCKET", "test-bucket");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const FLAG_ID = "4f7c1b2a-9d3e-4c5f-8a6b-1c2d3e4f5a6b";

function flagBody(credential: { deviceId: string; deviceSecret: string }, flagId = FLAG_ID) {
  return {
    ...credential,
    flagId,
    byteCount: 120_000,
    selectedRawText: "S/N: C02ZK1ABMD6R",
    selectedCleanedText: "C02ZK1ABMD6R",
    regions: [
      { text: "S/N: C02ZK1ABMD6R", confidence: 0.82, isDeviceIdentifier: true, x: 0.1, y: 0.2, width: 0.5, height: 0.05 },
      { text: "Model A2338", confidence: 0.9, isDeviceIdentifier: false, x: 0.1, y: 0.3, width: 0.3, height: 0.05 },
    ],
    rawRegionTexts: ["S/N: C02ZK1ABMD6R", "Model A2338", "Designed by Apple"],
    appVersion: "0.1.18",
    appBuild: "67",
  };
}

async function post(t: ReturnType<typeof convexTest>, path: string, body: unknown) {
  return t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("parses only well-formed flag bodies", () => {
  const credential = { deviceId: "d", deviceSecret: "s" };
  expect(ocrFlagInputFrom(flagBody(credential))?.regions).toHaveLength(2);
  expect(ocrFlagInputFrom({ ...flagBody(credential), flagId: "not-a-uuid" })).toBeNull();
  expect(ocrFlagInputFrom({ ...flagBody(credential), byteCount: 50_000_000 })).toBeNull();
  expect(ocrFlagInputFrom({ ...flagBody(credential), regions: [{ text: "x" }] })).toBeNull();
});

test("a flag returns an R2 upload URL and is listed only after the photo is confirmed", async () => {
  const t = convexTest(schema, modules);
  const { credential, workspaceId } = await enroll(t, "tester");

  const created = await post(t, "/api/mobile/ocr-flags", flagBody(credential));
  expect(created.status).toBe(200);
  const payload = await created.json() as { flagId: string; upload: { url: string; headers: Record<string, string> } };
  expect(payload.flagId).toBe(FLAG_ID);
  expect(payload.upload.url).toContain(`/test-bucket/ocr-flags/${workspaceId}/${FLAG_ID}.jpg`);
  expect(payload.upload.headers).toEqual({ "Content-Type": "image/jpeg" });
  expect(await t.query(listOcrFlags, {})).toEqual([]);

  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  expect((await post(t, "/api/mobile/ocr-flags/finalize", { ...credential, flagId: FLAG_ID })).status).toBe(409);

  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
  const finalized = await post(t, "/api/mobile/ocr-flags/finalize", { ...credential, flagId: FLAG_ID });
  expect(finalized.status).toBe(200);

  const flags = await t.query(listOcrFlags, {});
  expect(flags).toHaveLength(1);
  expect(flags[0]).toMatchObject({
    flagId: FLAG_ID,
    selectedRawText: "S/N: C02ZK1ABMD6R",
    selectedCleanedText: "C02ZK1ABMD6R",
    rawRegionTexts: ["S/N: C02ZK1ABMD6R", "Model A2338", "Designed by Apple"],
    status: "ready",
  });
  expect(flags[0]).not.toHaveProperty("workspaceId");
});

test("retrying a flag is idempotent and other devices cannot claim it", async () => {
  const t = convexTest(schema, modules);
  const { credential } = await enroll(t, "tester");
  const { credential: otherCredential } = await enroll(t, "other");

  expect((await post(t, "/api/mobile/ocr-flags", flagBody(credential))).status).toBe(200);
  expect((await post(t, "/api/mobile/ocr-flags", flagBody(credential))).status).toBe(200);
  expect((await post(t, "/api/mobile/ocr-flags", flagBody(otherCredential))).status).toBe(404);
  expect((await post(t, "/api/mobile/ocr-flags/finalize", { ...otherCredential, flagId: FLAG_ID })).status).toBe(404);
});

test("rejects bad credentials, malformed bodies and floods", async () => {
  const t = convexTest(schema, modules);
  const { credential } = await enroll(t, "tester");

  expect((await post(t, "/api/mobile/ocr-flags", flagBody({ ...credential, deviceSecret: "wrong" }))).status).toBe(401);
  expect((await post(t, "/api/mobile/ocr-flags", { ...credential, flagId: FLAG_ID })).status).toBe(400);

  for (let index = 0; index < OCR_FLAG_MAX_PER_HOUR; index += 1) {
    const flagId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    expect((await post(t, "/api/mobile/ocr-flags", flagBody(credential, flagId))).status).toBe(200);
  }
  expect((await post(t, "/api/mobile/ocr-flags", flagBody(credential))).status).toBe(429);
});
