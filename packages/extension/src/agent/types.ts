import type { AgentRequest, AgentDecisionResult } from "../../../../convex/browserAgent/contracts";

export type AgentObservation = AgentRequest["observation"];
export type AgentDecision = AgentDecisionResult;
export type AgentLog = { step: number; message: string; url?: string };
export type AgentState =
  | { kind: "idle"; log: AgentLog[] }
  | { kind: "running"; step: number; log: AgentLog[] }
  | { kind: "complete" | "blocked" | "stopped" | "error"; message: string; log: AgentLog[] };
export type AgentBrowser = {
  observe: (goal: string, step: number, signal: AbortSignal) => Promise<AgentObservation>;
  execute: (observation: AgentObservation, candidateId: string, signal: AbortSignal) => Promise<void>;
  close: () => void;
};
export type AgentDecide = (request: AgentRequest, signal: AbortSignal) => Promise<AgentDecision>;
