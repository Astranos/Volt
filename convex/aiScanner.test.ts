import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";

import {
  buildOpenRouterRequest,
  isValidUPCA,
  normalizeItemName,
  normalizeUPCA,
  parseAIResponse,
  requestOpenRouterAnalysis,
} from "./aiScanner";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const authorizePaidAIScannerDevice = makeFunctionReference<
  "query",
  { deviceId: string; deviceSecret: string },
  { authorized: boolean; errorCode?: "invalid-device" | "subscription-required" }
>("cloudWorkspace:authorizePaidAIScannerDevice");

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("AI scanner parsing", () => {
  test("validates UPC-A and normalizes a valid leading-zero EAN-13", () => {
    expect(isValidUPCA("036000291452")).toBe(true);
    expect(normalizeUPCA("036000291452")).toBe("036000291452");
    expect(normalizeUPCA("0036000291452")).toBe("036000291452");
    expect(normalizeUPCA("036000291453")).toBeNull();
    expect(normalizeUPCA("03600029145")).toBeNull();
  });

  test("normalizes names and rejects generic or oversized answers", () => {
    expect(normalizeItemName("  Super   Mario\n64  ")).toBe("Super Mario 64");
    expect(normalizeItemName("unknown")).toBeNull();
    expect(normalizeItemName("x".repeat(201))).toBeNull();
  });

  test("parses strict mode-specific JSON and returns null for invalid values", () => {
    expect(parseAIResponse("upc", '{"upc":"0036000291452"}')).toEqual({
      mode: "upc",
      value: "036000291452",
      format: "upc_a",
    });
    expect(parseAIResponse("name", '```json\n{"name":"Unknown"}\n```')).toEqual({
      mode: "name",
      value: null,
      format: "item-name",
    });
  });

  test("sends the configured model, JSON mode, and a JPEG data URL once", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"name":"Metroid Prime"}' } }] }), { status: 200 }),
    );
    const result = await requestOpenRouterAnalysis("name", Uint8Array.from([1, 2, 3]).buffer, {
      apiKey: "server-only-key",
      fetchImpl,
    });
    expect(result.value).toBe("Metroid Prime");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0][1];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer server-only-key" });
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      response_format: { type: string };
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    expect(body.model).toBe("z-ai/glm-5.3-flash");
    expect(body.response_format.type).toBe("json_object");
    expect(body.messages[0].content[1].image_url?.url).toBe("data:image/jpeg;base64,AQID");
    expect(buildOpenRouterRequest("name", new ArrayBuffer(0))).toContain("image/jpeg");
  });
});

describe("paid AI scanner authorization", () => {
  test("requires an active StoreKit entitlement and ignores complimentary access", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const userId = "user-ai-scanner";
    const deviceSecret = "device-secret";
    const { workspaceId, deviceId } = await t.run(async (ctx) => {
      const workspaceId = await ctx.db.insert("workspaces", {
        ownerClerkUserId: userId,
        name: "AI scanner test",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("entitlements", {
        clerkUserId: userId,
        kind: "manual",
        sourceIdentifier: "test-comped",
        productId: "com.volt.mobile.pro.monthly",
        status: "active",
        validFrom: now,
        updatedAt: now,
      });
      const deviceId = "device-ai-scanner";
      await ctx.db.insert("workspaceDevices", {
        workspaceId,
        deviceId,
        credentialHash: await hash(deviceSecret),
        kind: "ios",
        label: "AI scanner test device",
        createdAt: now,
        lastSeenAt: now,
      });
      return { workspaceId, deviceId };
    });
    expect(workspaceId).toBeDefined();
    await expect(t.query(authorizePaidAIScannerDevice, { deviceId, deviceSecret })).resolves.toEqual({
      authorized: false,
      errorCode: "subscription-required",
    });
    await t.run((ctx) => ctx.db.insert("entitlements", {
      clerkUserId: userId,
      kind: "storekit",
      sourceIdentifier: "transaction-ai-scanner",
      productId: "com.volt.mobile.pro.monthly",
      status: "active",
      validFrom: now,
      updatedAt: now,
    }));
    await expect(t.query(authorizePaidAIScannerDevice, { deviceId, deviceSecret })).resolves.toEqual({
      authorized: true,
    });
  });
});
