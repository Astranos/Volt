import { ConvexError } from "convex/values";
import { api } from "../../../../convex/_generated/api";
import type { AuditRequest, AuditDecisionResult } from "../../../../convex/priceAudit/contracts";
import type { AuditDecisions, SoldComparable } from "./types.ts";

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Audit stopped", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export type AuditActionClient = {
  action: (reference: typeof api.priceAudit.decide, args: { request: AuditRequest }) => Promise<AuditDecisionResult>;
};

export function createRemoteAuditDecisions(client: AuditActionClient, onRequest?: () => void): AuditDecisions {
  async function call(request: AuditRequest, signal: AbortSignal): Promise<AuditDecisionResult> {
    signal.throwIfAborted();
    onRequest?.();
    try {
      const result = await abortable(client.action(api.priceAudit.decide, { request }), signal);
      signal.throwIfAborted();
      if (result.kind !== request.kind) throw new Error("Unexpected audit decision.");
      return result;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ConvexError && typeof error.data === "string") throw new Error(error.data);
      throw new Error("Price Audit could not reach the signed-in server. Check your connection and sign-in, then retry.");
    }
  }
  return {
    async reviewItem(item, signal) {
      const result = await call({ kind: "reviewItem", item }, signal);
      return result.kind === "reviewItem" && result.accepted;
    },
    async chooseQuery(item, signal) {
      const result = await call({ kind: "chooseQuery", item }, signal);
      return result.kind === "chooseQuery" ? result.query : null;
    },
    async selectComparables(item, candidates, signal) {
      const matches: SoldComparable[] = [];
      for (let start = 0; start < candidates.length; start += 6) {
        const result = await call({ kind: "selectComparables", item, candidates: candidates.slice(start, start + 6) }, signal);
        if (result.kind === "selectComparables") matches.push(...result.comparables);
      }
      return matches;
    },
    async verifyResult(item, comparables, signal) {
      const verified: SoldComparable[] = [];
      for (let start = 0; start < comparables.length; start += 6) {
        const result = await call({ kind: "verifyResult", item, comparables: comparables.slice(start, start + 6) }, signal);
        if (result.kind === "verifyResult") verified.push(...result.comparables);
      }
      return verified;
    },
    async chooseNextPage(links, signal) {
      if (!links.length) return null;
      const result = await call({ kind: "chooseNextPage", links }, signal);
      return result.kind === "chooseNextPage" ? result.url : null;
    },
  };
}
