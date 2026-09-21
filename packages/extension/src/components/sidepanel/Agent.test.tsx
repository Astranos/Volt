import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));
const clerk = vi.hoisted(() => ({ signedIn: false as boolean | null }));
vi.mock("convex/react", () => ({ useConvex: () => ({}), useConvexAuth: () => auth }));
vi.mock("../access/ExtensionAccess", () => ({ useSidepanelSignedIn: () => clerk.signedIn }));
vi.mock("../../agent/remote-decisions", () => ({ createRemoteAgentDecision: vi.fn() }));
vi.mock("./SidepanelLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
import Agent, { AgentProgress } from "./Agent";
import { SIDEPANEL_TOOLS, isSidepanelToolId } from "../../lib/sidepanel-tools";

describe("Agent tool", () => {
  it("registers Agent and renders bounded task input and account gate", () => {
    expect(isSidepanelToolId("agent")).toBe(true);
    expect(SIDEPANEL_TOOLS.find((tool) => tool.id === "agent")?.label).toBe("Agent");
    const html = renderToStaticMarkup(<Agent />);
    expect(html).toContain("<textarea");
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain("Sign in using the account control");
    expect(html).toContain('disabled=""');
    expect(html).toContain("TypeSafe via Volt");
    expect(html).not.toContain('type="password"');
  });
  it("distinguishes backend connection from Clerk sign-in and loading", () => {
    clerk.signedIn = true;
    expect(renderToStaticMarkup(<Agent />)).toContain("server connection needs a refresh");
    auth.isLoading = true;
    expect(renderToStaticMarkup(<Agent />)).toContain("Checking your account");
    auth.isLoading = false; clerk.signedIn = false;
  });
  it("shows live steps and escaped completion evidence", () => {
    expect(renderToStaticMarkup(<AgentProgress state={{ kind: "running", step: 3, log: [{ step: 1, message: "Search cameras" }] }} />)).toContain("step 3 of 25");
    const html = renderToStaticMarkup(<AgentProgress state={{ kind: "complete", message: "Found <camera>", log: [] }} />);
    expect(html).toContain("Found &lt;camera&gt;");
    expect(html).toContain("Finished");
  });
});
