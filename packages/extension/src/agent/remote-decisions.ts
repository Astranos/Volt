import { api } from "../../../../convex/_generated/api";
import type { AgentRequest, AgentDecisionResult } from "../../../../convex/browserAgent/contracts";
import type { AgentDecide } from "./types";

export type AgentActionClient = { action: (reference: typeof api.browserAgent.decide, args: { request: AgentRequest }) => Promise<AgentDecisionResult> };

export function createRemoteAgentDecision(client: AgentActionClient): AgentDecide {
  return async (request, signal) => {
    signal.throwIfAborted();
    return new Promise<AgentDecisionResult>((resolve, reject) => {
      const abort = () => reject(new DOMException("Agent stopped", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      client.action(api.browserAgent.decide, { request }).then((result) => {
        if (signal.aborted) return abort();
        if (result.kind === "act" && !request.observation.candidates.some((candidate) => candidate.id === result.candidateId)) return reject(new Error("The server selected an unavailable action."));
        resolve(result);
      }, () => reject(new Error("Agent could not reach the signed-in server. Check your connection and try again."))).finally(() => signal.removeEventListener("abort", abort));
    });
  };
}
