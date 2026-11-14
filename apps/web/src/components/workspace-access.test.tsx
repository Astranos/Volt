import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  WorkspaceAccessContent,
  WorkspaceErrorBoundary,
  workspaceAccessState,
} from "./workspace-access";

describe("workspace access gate", () => {
  test("accepts only cloud capability resolved for the current Clerk account", () => {
    expect(workspaceAccessState(
      { clerkUserId: "current-user", capabilities: { cloudWorkspace: true } }, "current-user",
    )).toEqual({ status: "allowed" });
    expect(workspaceAccessState(
      { clerkUserId: "old-user", capabilities: { cloudWorkspace: true } }, "current-user",
    )).toEqual({ status: "error" });
    expect(workspaceAccessState(
      { clerkUserId: "current-user", capabilities: { cloudWorkspace: false } }, "current-user",
    )).toEqual({ status: "locked" });
    expect(workspaceAccessState(
      { error: "private error details" }, "current-user",
    )).toEqual({ status: "error" });
  });
  test.each(["loading", "locked", "error"] as const)("does not mount workspace queries while %s", (status) => {
    function QueryConsumer(): never {
      throw new Error("Workspace queries mounted too early");
    }
    const html = renderToStaticMarkup(
      <WorkspaceAccessContent state={{ status }} retry={() => {}}>
        <QueryConsumer />
      </WorkspaceAccessContent>,
    );
    expect(html).not.toContain("Workspace queries mounted too early");
  });

  test("mounts the workspace after cloud access is allowed, without a plan banner", () => {
    const html = renderToStaticMarkup(
      <WorkspaceAccessContent state={{ status: "allowed" }} retry={() => {}}>
        <p>My captures</p>
      </WorkspaceAccessContent>,
    );
    expect(html).toContain("My captures");
    expect(html).not.toContain("Free cloud workspace");
  });

  test("unavailable page explains access and offers retry without a purchase pitch", () => {
    const html = renderToStaticMarkup(
      <WorkspaceAccessContent state={{ status: "locked" }} retry={() => {}} />,
    );
    expect(html).toContain("Cloud workspace unavailable");
    expect(html).not.toContain("Donut Pro");
    expect(html).not.toContain("Get Donut for iPhone");
    expect(html).toContain("Check access again");
    expect(html).not.toContain("ConvexError");
  });

  test("does not display server exception details", () => {
    expect(WorkspaceErrorBoundary.getDerivedStateFromError()).toEqual({ status: "error" });
    const html = renderToStaticMarkup(
      <WorkspaceAccessContent state={{ status: "error" }} retry={() => {}} />,
    );
    expect(html).toContain("Try again");
    expect(html).not.toContain("private server stack");
  });
});
