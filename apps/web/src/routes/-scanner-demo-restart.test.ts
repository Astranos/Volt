import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { scheduleRecognitionRestart } from "./-scanner-demo-restart";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("deduplicates restart requests and clears the timer before restarting", () => {
  const timers = new Map<string, number>();
  const restart = vi.fn(() => expect(timers.has("peer")).toBe(false));
  const input = { timers, peerId: "peer", isActive: () => true, restart, delay: 250 };
  scheduleRecognitionRestart(input);
  scheduleRecognitionRestart(input);
  vi.advanceTimersByTime(250);
  expect(restart).toHaveBeenCalledOnce();
});

test("does not restart after the session stops or changes during the delay", () => {
  const timers = new Map<string, number>();
  const restart = vi.fn();
  let session = "original";
  scheduleRecognitionRestart({ timers, peerId: "peer", isActive: () => session === "original", restart, delay: 250 });
  session = "new-session";
  vi.advanceTimersByTime(250);
  expect(restart).not.toHaveBeenCalled();
  expect(timers.size).toBe(0);
});

test("peer shutdown can cancel its restart through the shared timer registry", () => {
  const timers = new Map<string, number>();
  const restart = vi.fn();
  scheduleRecognitionRestart({ timers, peerId: "peer", isActive: () => true, restart, delay: 250 });
  for (const timer of timers.values()) window.clearTimeout(timer);
  timers.clear();
  vi.advanceTimersByTime(250);
  expect(restart).not.toHaveBeenCalled();
});
