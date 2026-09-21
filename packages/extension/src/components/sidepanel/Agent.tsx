import React, { useEffect, useRef, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { Bot, ArrowRight, Square } from "lucide-react";
import { useSidepanelSignedIn } from "../access/ExtensionAccess";
import { Button } from "../ui/button";
import SidepanelLayout from "./SidepanelLayout";
import { createAgentBrowser } from "../../agent/browser";
import { createRemoteAgentDecision } from "../../agent/remote-decisions";
import { runAgent } from "../../agent/runner";
import { MAX_GOAL_LENGTH } from "../../agent/policy";
import type { AgentState } from "../../agent/types";
import "./agent.css";

export function AgentProgress({ state }: { state: AgentState }) {
  if (state.kind === "idle") return null;
  return <section className="agent-progress" aria-label="Agent progress">
    <p role="status" aria-live="polite" className="agent-status">{state.kind === "running" ? `Working · step ${state.step} of 25` : state.kind === "complete" ? "Finished" : state.kind === "blocked" ? "Needs your attention" : state.kind === "stopped" ? "Stopped" : "Unable to continue"}</p>
    {state.kind !== "running" ? <p className="agent-message">{state.message}</p> : null}
    <ol className="agent-log">{state.log.map((entry) => <li key={entry.step}><span className="agent-step">{entry.step}</span><span>{entry.message}</span></li>)}</ol>
  </section>;
}

export default function Agent() {
  const convex = useConvex();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const signedIn = useSidepanelSignedIn();
  const [goal, setGoal] = useState("");
  const [state, setState] = useState<AgentState>({ kind: "idle", log: [] });
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const running = state.kind === "running";
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => { if (!isLoading && !isAuthenticated) controller.current?.abort(); }, [isLoading, isAuthenticated]);

  async function start() {
    if (controller.current || !isAuthenticated || isLoading || !goal.trim()) return;
    const active = new AbortController();
    controller.current = active;
    setState({ kind: "running", step: 1, log: [] });
    try {
      const browser = await createAgentBrowser(active.signal);
      await runAgent({ goal: goal.trim(), browser, decide: createRemoteAgentDecision(convex), signal: active.signal, onUpdate: (next) => { if (mounted.current && controller.current === active) setState(next); } });
    } catch (error) {
      if (mounted.current) setState({ kind: active.signal.aborted ? "stopped" : "error", message: active.signal.aborted ? "Stopped." : error instanceof Error ? error.message : "Could not start Agent.", log: [] });
    } finally { if (controller.current === active) controller.current = null; }
  }

  return <SidepanelLayout className="agent-root"><div className="agent-content">
    <header className="agent-intro"><span className="agent-icon"><Bot size={21} aria-hidden="true" /></span><div><h2>Agent</h2><p>Ask Jev to explore the active tab.</p></div></header>
    <label className="agent-task-label" htmlFor="agent-task">What would you like to do?</label>
    <textarea id="agent-task" className="agent-task" rows={5} maxLength={MAX_GOAL_LENGTH} placeholder={'Find “used Canon cameras” on this site'} value={goal} disabled={running} onChange={(event) => setGoal(event.target.value)} />
    <p className="agent-note">Starting shares visible page text and your task with TypeSafe via Volt. Agent can browse, search and filter. Purchases, messages, account actions and sensitive fields are blocked.</p>
    {!isAuthenticated ? <p className="agent-account" role="status">{isLoading || signedIn === null ? "Checking your account…" : signedIn ? "You're signed in, but the server connection needs a refresh." : "Sign in using the account control to start Agent."}</p> : null}
    <div className="agent-actions"><Button type="button" className="agent-start" disabled={running || isLoading || !isAuthenticated || !goal.trim()} onClick={start}>{running ? "Working…" : "Start"}<ArrowRight size={15} aria-hidden="true" /></Button>{running ? <Button type="button" variant="outline" className="agent-stop" onClick={() => controller.current?.abort()}><Square size={13} aria-hidden="true" />Stop</Button> : null}</div>
    <p className="agent-note">Active tab only · 25 steps maximum. Switching tools or signing out stops this task. Page changes already made are not undone.</p>
    <AgentProgress state={state} />
  </div></SidepanelLayout>;
}
