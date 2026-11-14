import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../lib/env", () => ({ CLERK_PUBLISHABLE_KEY: "pk_live_existing-instance" }));
vi.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <div data-clerk-provider>{children}</div>,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("renders Donut's public site without initializing Clerk on the new origin", async () => {
  vi.stubGlobal("window", { location: { hostname: "donut.juanquenga.com" } });
  const { AppProviders, authConfigured } = await import("./app-providers");
  expect(authConfigured).toBe(false);
  expect(renderToStaticMarkup(<AppProviders><p>Donut</p></AppProviders>)).toBe("<p>Donut</p>");
});

it("keeps the existing Clerk provider on the trusted account origin", async () => {
  vi.stubGlobal("window", { location: { hostname: "voltresale.app" } });
  const { AppProviders, authConfigured } = await import("./app-providers");
  expect(authConfigured).toBe(true);
  expect(renderToStaticMarkup(<AppProviders><p>Donut</p></AppProviders>)).toContain("data-clerk-provider");
});
