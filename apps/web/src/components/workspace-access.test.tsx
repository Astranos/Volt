import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import {
  WorkspaceAccessContent,
  WorkspaceErrorBoundary,
  workspaceAccessState,
} from "./workspace-access";

describe("workspace access gate", () => {
  test("accepts only access resolved for the current Clerk account", () => {
    expect(workspaceAccessState(
      { clerkUserId: "current-user", hasFullAppAccess: true }, "current-user",
    )).toEqual({ status: "allowed" });
    expect(workspaceAccessState(
      { clerkUserId: "old-user", hasFullAppAccess: true }, "current-user",
    )).toEqual({ status: "error" });
    expect(workspaceAccessState(
      { clerkUserId: "current-user", hasFullAppAccess: false }, "current-user",
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

  test("mounts the workspace only after access is allowed", () => {
    const html = renderToStaticMarkup(
      <WorkspaceAccessContent state={{ status: "allowed" }} retry={() => {}}>
        <p>My captures</p>
      </WorkspaceAccessContent>,
    );
    expect(html).toContain("My captures");
  });

  test("non-Pro page explains access and offers a real subscription destination and retry", () => {
    const html = renderToStaticMarkup(
      <WorkspaceAccessContent state={{ status: "locked" }} retry={() => {}} />,
    );
    expect(html).toContain("Your cloud workspace comes with Volt Pro");
    expect(html).toContain("complimentary access");
    expect(html).toContain("apps.apple.com/us/app/volt-scanner/id6771770148");
    expect(html).toContain("Check access again");
    expect(html).not.toContain("ConvexError");
  });

  test("classifies entitlement expiry without displaying server exception details", () => {
    expect(WorkspaceErrorBoundary.getDerivedStateFromError(
      new ConvexError("Volt Pro subscription or complimentary access required"),
    )).toEqual({ status: "locked" });
    expect(WorkspaceErrorBoundary.getDerivedStateFromError(
      new Error("private server stack"),
    )).toEqual({ status: "error" });
    const html = renderToStaticMarkup(
      <WorkspaceAccessContent state={{ status: "error" }} retry={() => {}} />,
    );
    expect(html).toContain("Try again");
    expect(html).not.toContain("private server stack");
  });
});
