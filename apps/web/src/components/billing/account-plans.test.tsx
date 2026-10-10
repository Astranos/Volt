import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ paid: false, enabled: false }));
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useQuery: (reference: unknown) => {
    const path = String(reference);
    return path.includes("webBilling")
      ? {
          offers: {
            workspace: {
              monthlyPriceUsd: 12,
              freeRecordsLimit: 1000,
              paidRecordsLimit: 25000,
              freeBytesLimit: 104857600,
              paidBytesLimit: 1073741824,
              freeRetentionDays: 7,
            },
            api: {
              monthlyPriceUsd: 29,
              evaluationLimit: 100,
              monthlyLimit: 5000,
            },
          },
          billingEnabled: false,
          portalEnabled: false,
          workspace: { checkoutEnabled: false },
          api: { checkoutEnabled: false },
        }
      : path.includes("workspaceStorage")
        ? {
            enabled: state.enabled,
            tier: state.paid ? "workspace" : "free",
            access: "write",
            retentionDays: state.paid ? null : 7,
            recordsUsed: 4,
            recordsLimit: state.paid ? 25000 : 1000,
            bytesUsed: 20,
            bytesLimit: 104857600,
          }
        : {
            tier: "evaluation",
            used: 2,
            limit: 100,
            remaining: 98,
            enforcementEnabled: false,
            resetsAt: null,
          };
  },
}));
vi.mock("../../../../../convex/_generated/api", () => ({
  api: {
    webBilling: { getAccountBilling: "webBilling" },
    workspaceStorage: { getUsage: "workspaceStorage" },
    productApiUsage: { getStatus: "usage" },
    stripeBilling: { createCheckout: "checkout", createPortal: "portal" },
  },
}));
import { AccountPlans, StorageSummary } from "./account-plans";
describe("account plans", () => {
  test("disabled setup exposes no usable purchase controls and labels pilot limits", () => {
    state.paid = false;
    state.enabled = false;
    const html = renderToStaticMarkup(<AccountPlans />);
    expect(html).toContain("Checkout is unavailable");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("not yet enforced");
    expect(html).toContain("100 successful requests total");
  });
  test("storage summary shows actual policy and links to plans", () => {
    state.enabled = true;
    state.paid = false;
    expect(renderToStaticMarkup(<StorageSummary />)).toContain("7-day history");
    state.paid = true;
    const html = renderToStaticMarkup(<StorageSummary />);
    expect(html).toContain("Persistent history");
    expect(html).toContain('href="/billing"');
  });
});
