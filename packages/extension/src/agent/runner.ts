import { MAX_AGENT_STEPS, MAX_GOAL_LENGTH } from "./policy.ts";
import type { AgentBrowser, AgentDecide, AgentLog, AgentState } from "./types.ts";

export async function runAgent({ goal, browser, decide, signal, onUpdate }: {
  goal: string; browser: AgentBrowser; decide: AgentDecide; signal: AbortSignal; onUpdate: (state: AgentState) => void;
}): Promise<void> {
  const log: AgentLog[] = [];
  const finish = (kind: "complete" | "blocked" | "stopped" | "error", message: string) => onUpdate({ kind, message, log: [...log] });
  try {
    if (!goal.trim() || goal.length > MAX_GOAL_LENGTH) throw new Error("Enter a task of 1–2,000 characters.");
    for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
      signal.throwIfAborted();
      onUpdate({ kind: "running", step, log: [...log] });
      const observation = await browser.observe(goal, step - 1, signal);
      signal.throwIfAborted();
      const decision = await decide({ goal, observation }, signal);
      signal.throwIfAborted();
      if (decision.kind === "blocked") return finish("blocked", decision.reason);
      if (decision.kind === "finish") return finish("complete", decision.summary);
      const candidate = observation.candidates.find((entry) => entry.id === decision.candidateId);
      if (!candidate) throw new Error("Jev selected an action that was not observed. Nothing was executed.");
      log.push({ step, message: candidate.description, url: observation.url });
      onUpdate({ kind: "running", step, log: [...log] });
      await browser.execute(observation, candidate.id, signal);
    }
    finish("blocked", "Reached the 25-step limit. Review the page before starting another task.");
  } catch (error) {
    finish(signal.aborted ? "stopped" : "error", signal.aborted ? "Stopped. An in-flight server request may still finish." : error instanceof Error ? error.message : "The agent could not continue.");
  } finally { browser.close(); }
}
