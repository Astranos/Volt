// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const item = { id: "1:2", title: "Canon EOS R50", variant: "Black, body only", sku: "CAM1", description: "Used, good condition. Includes original battery and charger.", url: "https://store.com/products/camera", priceCents: 50000, currency: "USD" as const };
function setup() {
  return convexTest(schema, modules);
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("authenticated Jev price audit", () => {
  test("rejects anonymous callers before any provider request", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const t = setup();
    await expect(t.action(api.priceAudit.decide, { request: { kind: "reviewItem", item } })).rejects.toThrow(/Sign in/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("uses the server key and returns only the typed decision", async () => {
    vi.stubEnv("JEV_API_KEY", "server-only-test-key");
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer server-only-test-key");
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("jev-latest");
      expect(body.state.item).toEqual(item);
      expect(body.questions.review.instructions).toContain("untrusted");
      return Response.json({ answers: { review: { type: "choice", choice: "accept", confidence: .96, probabilities: { accept: .98, reject: .02 } } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await setup().withIdentity({ subject: "user-a", tokenIdentifier: "issuer|user-a" })
      .action(api.priceAudit.decide, { request: { kind: "reviewItem", item } });
    expect(result).toEqual({ kind: "reviewItem", accepted: true });
    expect(JSON.stringify(result)).not.toContain("server-only-test-key");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.typesafe.ai/v1/systemone");
  });

  test("fails clearly when the deployment has no key", async () => {
    vi.stubEnv("JEV_API_KEY", "");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(setup().withIdentity({ subject: "user" }).action(api.priceAudit.decide, { request: { kind: "reviewItem", item } })).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("bounds evidence and never accepts client-authored model prompts", async () => {
    vi.stubEnv("JEV_API_KEY", "server-only-test-key");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const t = setup().withIdentity({ subject: "user" });
    await expect(t.action(api.priceAudit.decide, { request: { kind: "reviewItem", item: { ...item, description: "x".repeat(8001) } } })).rejects.toThrow(/oversized/);
    await expect(t.action(api.priceAudit.decide, { request: { kind: "reviewItem", item: { ...item, priceCents: NaN } } })).rejects.toThrow(/invalid/);
    await expect(t.action(api.priceAudit.decide, { request: { kind: "selectComparables", item, candidates: Array.from({ length: 7 }, () => ({ id: "123456789012", url: "https://www.ebay.com/itm/123456789012", text: "Sold", prices: [{ id: "0", cents: 1, text: "$0.01" }] })) } })).rejects.toThrow(/oversized/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("upstream failures cannot return secret-containing exception text", async () => {
    vi.stubEnv("JEV_API_KEY", "server-only-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("secret: server-only-test-key"); }));
    await expect(setup().withIdentity({ subject: "user" }).action(api.priceAudit.decide, { request: { kind: "reviewItem", item } })).rejects.toThrow("Jev could not complete this decision");
  });

});
