import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { AppLayout } from "../app-shell";
import { SettingsContent } from "./settings-page";

const usage = { enabled: true, retentionDays: 7, recordsUsed: 1250, recordsLimit: 10000, bytesUsed: 52_428_800, bytesLimit: 1_073_741_824 };

describe("settings", () => {
  test("shows the account, storage meters, and retention", () => {
    const html = renderToStaticMarkup(
      <SettingsContent account={{ name: "Sam Lee", email: "sam@example.com", imageUrl: null }} usage={usage} onManageAccount={vi.fn()} onSignOut={vi.fn()} />,
    );
    expect(html).toContain("Sam Lee");
    expect(html).toContain("sam@example.com");
    expect(html).toContain("1,250 of 10,000");
    expect(html).toContain('aria-valuenow="13"');
    expect(html).toContain("50.0 MB of 1 GB");
    expect(html).toContain("kept for 7 days");
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Free");
  });

  test("waits for storage usage", () => {
    const html = renderToStaticMarkup(<SettingsContent account={null} usage={null} onManageAccount={vi.fn()} onSignOut={vi.fn()} />);
    expect(html).toContain("Loading storage");
  });

  test("the sidebar lists every section, with settings current", () => {
    const html = renderToStaticMarkup(<AppLayout current="settings"><p>Settings</p></AppLayout>);
    for (const href of ["/dashboard", "/scanner-results", "/handbook", "/settings"]) expect(html).toContain(`href="${href}"`);
    expect(html).toMatch(/href="\/settings"[^>]*aria-current="page"/);
    expect(html).toContain("Capture history");
  });
});
