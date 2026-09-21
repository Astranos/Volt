import { describe, expect, it, vi } from "vitest";
import { createRemoteAgentDecision, type AgentActionClient } from "./remote-decisions";
import type { AgentRequest, AgentDecisionResult } from "../../../../convex/browserAgent/contracts";

const request: AgentRequest = { goal: "Find cameras", observation: { documentId: "doc", url: "https://www.ebay.com/", title: "eBay", text: "Search", truncated: false, step: 0, candidates: [{ id: "one", kind: "click", description: "Click Search" }] } };
describe("Agent remote decisions", () => {
  it("passes typed observation and rejects invented action IDs", async () => {
    const action: AgentActionClient["action"] = vi.fn(async () => ({ kind: "act", candidateId: "invented" } satisfies AgentDecisionResult));
    await expect(createRemoteAgentDecision({ action })(request, new AbortController().signal)).rejects.toThrow("unavailable action");
    expect(action).toHaveBeenCalledWith(expect.anything(), { request });
    expect(JSON.stringify(request)).not.toMatch(/selector|apiKey/);
  });
  it("cancels waiting and prevents a pre-aborted call reaching the server", async () => {
    const action: AgentActionClient["action"] = vi.fn(() => new Promise<AgentDecisionResult>(() => {}));
    const decide = createRemoteAgentDecision({ action });
    const controller = new AbortController();
    const pending = decide(request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    await expect(decide(request, controller.signal)).rejects.toThrow();
    expect(action).toHaveBeenCalledTimes(1);
  });
});
