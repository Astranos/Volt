import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DashboardHome } from "./dashboard-home";
import { AppLayout } from "../app-shell";

describe("dashboard and scanner navigation", () => {
  test("dashboard links to scanner results", () => {
    const html = renderToStaticMarkup(
      <DashboardHome />,
    );
    expect(html).toContain("Dashboard");
    expect(html).toContain('href="/scanner-results"');
    expect(html).not.toContain("Search captures");
    expect(html).not.toContain("Export CSV");
  });

  test("scanner results has its own active sidebar entry", () => {
    const html = renderToStaticMarkup(
      <AppLayout current="scanner-results">
        <p>Scanner content</p>
      </AppLayout>,
    );
    expect(html).toMatch(/href="\/scanner-results"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/href="\/dashboard"[^>]*aria-current="page"/);
    expect(html).toContain("Scanner content");
  });
});
