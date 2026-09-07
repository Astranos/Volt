import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({
  configured: false,
  loaded: false,
  signedIn: false,
}));

vi.mock("./app-providers", () => ({
  get authConfigured() {
    return auth.configured;
  },
}));
vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ isLoaded: auth.loaded, isSignedIn: auth.signedIn }),
  UserButton: () => <button aria-label="Open user menu">Account avatar</button>,
}));

import { SiteFooter, SiteHeader, SiteHeaderFrame } from "../site-chrome";

describe("public discovery navigation", () => {
  beforeEach(() => {
    auth.configured = false;
    auth.loaded = false;
    auth.signedIn = false;
  });

  test("renders the full public header without an auth provider", () => {
    const header = renderToStaticMarkup(<SiteHeaderFrame />);
    expect(header).toContain('aria-label="Volt home"');
    expect(header).toContain('src="/favicon.svg"');
    expect(header).toContain('href="/upc-search"');
    expect(header).toContain("Support");
    expect(header).toContain('href="/sign-in"');
    expect(header).not.toContain('href="/dashboard"');
  });

  test("makes UPC search discoverable without an account", () => {
    const header = renderToStaticMarkup(<SiteHeader />);
    const footer = renderToStaticMarkup(<SiteFooter />);
    expect(header).toContain('href="/upc-search"');
    expect(header).toContain("UPC search");
    expect(header).toContain('href="/sign-in"');
    expect(header).not.toContain('href="/dashboard"');
    expect(footer).toContain('href="/upc-search"');
    expect(footer).toContain("Free UPC search");
  });

  test("offers sign in to a signed-out visitor", () => {
    auth.configured = true;
    auth.loaded = true;
    const header = renderToStaticMarkup(<SiteHeader />);
    expect(header).toContain('href="/sign-in"');
    expect(header).not.toContain('href="/dashboard"');
    expect(header).not.toContain("Open user menu");
  });

  test("shows dashboard and Clerk's account menu when signed in", () => {
    auth.configured = true;
    auth.loaded = true;
    auth.signedIn = true;
    const header = renderToStaticMarkup(<SiteHeader />);
    expect(header).toContain('href="/dashboard"');
    expect(header).toContain('aria-label="Open user menu"');
    expect(header).not.toContain('href="/sign-in"');
  });

  test("does not show signed-in controls before auth finishes loading", () => {
    auth.configured = true;
    auth.signedIn = true;
    const header = renderToStaticMarkup(<SiteHeader />);
    expect(header).toContain('href="/sign-in"');
    expect(header).not.toContain('href="/dashboard"');
    expect(header).not.toContain("Open user menu");
  });

  test("keeps the scanner header focused on support", () => {
    const header = renderToStaticMarkup(<SiteHeader variant="scanner" />);
    expect(header).not.toContain('href="/upc-search"');
    expect(header).toContain("Support");
  });
});
