// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { validBrowserAgentRequest, type BrowserAgentRequest, type BrowserAgentResult } from "./browserAgent/contracts";
import { chooseBrowserAction } from "./browserAgent/decision";

const modules = import.meta.glob("./**/*.ts");
const decide = makeFunctionReference<"action", { request: BrowserAgentRequest }, BrowserAgentResult>("browserAgent:decide");
const request: BrowserAgentRequest = {
  goal: "Find the shipping information",
  observation: { documentId: "document-1", url: "https://shop.com/", title: "Shop", text: "Shipping information", step: 0, truncated: false,
    candidates: [{ id: "link-1", kind: "click", description: "Open shipping information" }] },
};
const setup = () => convexTest(schema, modules);
const signedIn = () => setup().withIdentity({ subject: "user-1" });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function response(choice = "candidate_0", confidence = .95) {
  return Response.json({ answers: { next: { type: "choice", choice, confidence,
    probabilities: { candidate_0: choice === "candidate_0" ? .98 : .01, finish: choice === "finish" ? .98 : .01, blocked: choice === "blocked" ? .98 : .01 },
  } } });
}

describe("bounded browser Agent", () => {
  test("requires authentication before provider access", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(setup().action(decide, { request })).rejects.toThrow(/Sign in/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("keeps the server key private and returns only a locally supplied action ID", async () => {
    vi.stubEnv("JEV_API_KEY", "server-only-key");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer server-only-key");
      const body = JSON.parse(String(init.body));
      expect(body.state).toEqual(request);
      expect(body.questions.next.instructions).toContain("untrusted");
      expect(body.questions.next.instructions).toContain("Never invent selectors");
      expect(Object.keys(body.questions.next.criteria)).toEqual(["finish", "blocked", "candidate_0"]);
      expect(String(init.body)).not.toContain("server-only-key");
      return response();
    }));
    expect(await signedIn().action(decide, { request })).toEqual({ kind: "act", candidateId: "link-1" });
  });
  test("rejects foreign provider choices and never leaks upstream error contents", async () => {
    vi.stubEnv("JEV_API_KEY", "server-only-key");
    vi.stubGlobal("fetch", vi.fn(async () => response("foreign-selector")));
    await expect(signedIn().action(decide, { request })).rejects.toThrow(/No action was authorized/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("server-only-key and private DOM"); }));
    try { await signedIn().action(decide, { request }); throw new Error("Expected failure"); }
    catch (error) { expect(String(error)).toContain("No action was authorized"); expect(String(error)).not.toContain("server-only-key"); expect(String(error)).not.toContain("private DOM"); }
  });
  test("bounds observations and rejects duplicate candidate IDs before any provider request", async () => {
    vi.stubEnv("JEV_API_KEY", "server-only-key");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const invalid: BrowserAgentRequest[] = [
      { ...request, goal: "x".repeat(2001) },
      { ...request, observation: { ...request.observation, text: "x".repeat(20_001) } },
      { ...request, observation: { ...request.observation, candidates: [...request.observation.candidates, ...request.observation.candidates] } },
      { ...request, observation: { ...request.observation, step: 25 } },
      { ...request, observation: { ...request.observation, step: NaN } },
      { ...request, observation: { ...request.observation, url: "file:///private/key" } },
      { ...request, observation: { ...request.observation, url: "https://user:password@shop.com" } },
    ];
    for (const candidate of invalid) await expect(signedIn().action(decide, { request: candidate })).rejects.toThrow(/invalid or oversized/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(validBrowserAgentRequest({ ...request, observation: { ...request.observation, step: 24 } })).toBe(true);
  });
  test("wire validation disallows selectors, values and client-authored prompt fields", async () => {
    vi.stubEnv("JEV_API_KEY", "server-only-key");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const extra = { ...request, observation: { ...request.observation, candidates: [{ id: "link-1", kind: "click" as const, description: "Open shipping", selector: "#purchase", value: "secret" }] } };
    await expect(signedIn().action(decide, { request: extra })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("completion and blocking contain server-owned summaries and respect incomplete evidence", async () => {
    vi.stubEnv("JEV_API_KEY", "server-only-key");
    vi.stubGlobal("fetch", vi.fn(async () => response("finish")));
    expect(await signedIn().action(decide, { request })).toMatchObject({ kind: "finish", summary: expect.stringContaining("Review the page") });
    expect(await signedIn().action(decide, { request: { ...request, observation: { ...request.observation, truncated: true } } })).toMatchObject({ kind: "blocked" });
    vi.stubGlobal("fetch", vi.fn(async () => response("candidate_0", .2)));
    expect(await signedIn().action(decide, { request })).toMatchObject({ kind: "blocked" });
  });
  test("fails safely without a configured key", async () => {
    vi.stubEnv("JEV_API_KEY", "");
    await expect(signedIn().action(decide, { request })).rejects.toThrow(/not configured/);
  });
  test("decision mapping independently rejects foreign candidate choices", async () => {
    await expect(chooseBrowserAction({ choose: async () => ({ next: { choice: "link-1", confidence: .99, probability: .99 } }) }, request)).rejects.toThrow(/unrecognized/);
  });
});
