import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { WorkspaceContent } from "./workspace-view";
import { DashboardOverview } from "./dashboard-overview";
import type { CaptureBatch } from "../../lib/workspace";

const actions = {
  remove: async () => undefined,
  restore: async () => undefined,
  copy: async () => undefined,
  resolvePhoto: async () => "https://example.com/photo.jpg",
  copiedKey: null,
};

describe("dashboard presentation", () => {
  test("renders loading state without requiring authentication providers", () => {
    const html = renderToStaticMarkup(
      <WorkspaceContent {...actions} snapshot={null} isLoading isEmpty />,
    );
    expect(html).toContain("Loading your dashboard");
    expect(html).not.toContain("Nothing captured yet");
  });

  test("empty workspace has onboarding, real zero counts, disabled export, and search", () => {
    const html = renderToStaticMarkup(
      <WorkspaceContent
        {...actions}
        snapshot={null}
        isLoading={false}
        isEmpty
      />,
    );
    expect(html).toContain("Dashboard");
    expect(html).toContain("Nothing captured yet");
    expect(html).toContain("0 captures over the last 7 days");
    expect(html).toContain("disabled");
    expect(html).toContain("Search captures");
    expect(html).toContain("Trash");
  });

  test("overview computes activity from actual batch data", () => {
    const createdAt = new Date().toISOString();
    const batches: CaptureBatch[] = [
      {
        id: "batch-1",
        createdAt,
        updatedAt: createdAt,
        deliveryState: "available",
        deliveries: [],
        results: [
          {
            id: "capture-1",
            type: "barcode",
            value: "0123456789",
            createdAt,
            deliveryState: "available",
            byteCount: 10,
          },
        ],
      },
    ];
    const html = renderToStaticMarkup(<DashboardOverview batches={batches} />);
    expect(html).toContain("1 capture over the last 7 days");
    expect(html).toContain("Get the iPhone app");
  });
});
