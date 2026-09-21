import { describe, expect, test, vi } from "vitest";
import { createRemoteAuditDecisions, type AuditActionClient } from "./remote-decisions";
import type { AuditRequest, AuditDecisionResult } from "../../../../convex/priceAudit/contracts";

const item = { id: "1", title: "Camera", variant: "Black", sku: "", description: "Used", url: "https://store.com/products/camera", priceCents: 10000, currency: "USD" as const };

describe("remote price-audit decisions", () => {
  test("requires no key, sends bounded semantic requests, and skips empty batches", async () => {
    const requests: AuditRequest[] = [];
    const action: AuditActionClient["action"] = vi.fn(async (_reference, { request }) => {
      requests.push(request);
      return { kind: "selectComparables", comparables: [] } satisfies AuditDecisionResult;
    });
    const adapter = createRemoteAuditDecisions({ action });
    const candidates = Array.from({ length: 13 }, (_, index) => ({ id: `${123456789010 + index}`, url: "https://www.ebay.com/itm/123456789010", text: "Sold", prices: [{ id: "0", text: "$100.00", cents: 10000 }] }));
    await adapter.selectComparables(item, candidates, new AbortController().signal);
    expect(requests.map((request) => request.kind === "selectComparables" ? request.candidates.length : 0)).toEqual([6, 6, 1]);
    expect(JSON.stringify(requests)).not.toMatch(/apiKey|questions|instructions/);
    await adapter.selectComparables(item, [], new AbortController().signal);
    expect(requests).toHaveLength(3);
  });

  test("stop returns promptly without pretending to cancel the server request", async () => {
    const action: AuditActionClient["action"] = vi.fn(() => new Promise<AuditDecisionResult>(() => {}));
    const adapter = createRemoteAuditDecisions({ action });
    const controller = new AbortController();
    const request = adapter.reviewItem(item, controller.signal);
    controller.abort();
    await expect(request).rejects.toThrow();
    await expect(adapter.reviewItem(item, controller.signal)).rejects.toThrow();
    expect(action).toHaveBeenCalledTimes(1);
  });
});
