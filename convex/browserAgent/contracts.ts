import { v, type Infer } from "convex/values";

export const candidateValidator = v.object({
  id: v.string(),
  kind: v.union(v.literal("click"), v.literal("fill"), v.literal("select"), v.literal("navigate"), v.literal("back"), v.literal("scroll")),
  description: v.string(),
});
export const observationValidator = v.object({
  documentId: v.string(), url: v.string(), title: v.string(), text: v.string(),
  truncated: v.boolean(), step: v.number(), candidates: v.array(candidateValidator),
});
export const requestValidator = v.object({ goal: v.string(), observation: observationValidator });
export const resultValidator = v.union(
  v.object({ kind: v.literal("act"), candidateId: v.string() }),
  v.object({ kind: v.literal("finish"), summary: v.string() }),
  v.object({ kind: v.literal("blocked"), reason: v.string() }),
);
export type BrowserAgentRequest = Infer<typeof requestValidator>;
export type BrowserAgentObservation = Infer<typeof observationValidator>;
export type BrowserAgentCandidate = Infer<typeof candidateValidator>;
export type BrowserAgentResult = Infer<typeof resultValidator>;
export type AgentRequest = BrowserAgentRequest;
export type AgentDecisionResult = BrowserAgentResult;

export function validBrowserAgentRequest({ goal, observation }: BrowserAgentRequest): boolean {
  if (!goal.trim() || goal.length > 2000 || observation.title.length > 500 || observation.text.length > 20_000 ||
      !/^[a-zA-Z0-9:_-]{1,128}$/.test(observation.documentId) || observation.url.length > 2048 ||
      !Number.isInteger(observation.step) || observation.step < 0 || observation.step >= 25 || observation.candidates.length > 60) return false;
  try {
    const url = new URL(observation.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) ||
        /(?:^|\.)(?:localhost|local|internal|invalid|test)$/i.test(url.hostname)) return false;
  } catch { return false; }
  const ids = new Set<string>();
  for (const candidate of observation.candidates) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id) || ids.has(candidate.id) ||
        !candidate.description.trim() || candidate.description.length > 500) return false;
    ids.add(candidate.id);
  }
  return JSON.stringify({ goal, observation }).length <= 60_000;
}
