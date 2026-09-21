import test from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "./runner.ts";

const observation = (step) => ({ documentId: `doc${step}`, url: "https://www.ebay.com/", title: "eBay", text: "Results", truncated: false, step, candidates: [{ id: "one", kind: "scroll", description: "Scroll down" }] });
function fixture() {
  const events = [], states = [];
  const controller = new AbortController();
  const browser = { observe: async (_goal, step) => { events.push(`observe${step}`); return observation(step); }, execute: async () => { events.push("execute"); }, close: () => { events.push("close"); } };
  return { events, states, controller, browser, options: { goal: "Find cameras", browser, signal: controller.signal, onUpdate: (state) => states.push(state) } };
}
test("reobserves after each action and ends with evidence-bearing decision", async () => {
  const f = fixture(); let calls = 0;
  await runAgent({ ...f.options, decide: async () => ++calls === 1 ? { kind: "act", candidateId: "one" } : { kind: "finish", summary: "Found camera results on eBay." } });
  assert.deepEqual(f.events, ["observe0", "execute", "observe1", "close"]);
  assert.equal(f.states.at(-1).kind, "complete");
});
test("unobserved actions are never executed", async () => {
  const f = fixture();
  await runAgent({ ...f.options, decide: async () => ({ kind: "act", candidateId: "invented" }) });
  assert.deepEqual(f.events, ["observe0", "close"]);
  assert.equal(f.states.at(-1).kind, "error");
});
test("25-step cap and blocked response stop", async () => {
  const f = fixture();
  await runAgent({ ...f.options, decide: async () => ({ kind: "act", candidateId: "one" }) });
  assert.equal(f.events.filter((e) => e === "execute").length, 25);
  assert.equal(f.states.at(-1).kind, "blocked");
  const blocked = fixture();
  await runAgent({ ...blocked.options, decide: async () => ({ kind: "blocked", reason: "No safe action" }) });
  assert.deepEqual(blocked.events, ["observe0", "close"]);
});
test("abort while deciding cannot execute late actions", async () => {
  const f = fixture();
  await runAgent({ ...f.options, decide: async () => { f.controller.abort(); return { kind: "act", candidateId: "one" }; } });
  assert.deepEqual(f.events, ["observe0", "close"]);
  assert.equal(f.states.at(-1).kind, "stopped");
});
