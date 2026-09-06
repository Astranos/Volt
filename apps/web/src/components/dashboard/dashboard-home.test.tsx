import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DashboardHome } from "./dashboard-home";
import { AppLayout } from "../app-shell";

describe("dashboard and scanner navigation", () => {
  test("dashboard contains activity and tool links, not scanner result controls", () => {
    const html = renderToStaticMarkup(
      <DashboardHome activity={<section>Catalog activity fixture</section>} />,
    );
    expect(html).toContain("Dashboard / Activity");
    expect(html).toContain("Catalog activity fixture");
    for (const path of ["/scanner-results", "/catalog", "/api-keys"]) {
      expect(html).toContain(`href="${path}"`);
    }
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
