import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { SidepanelClerkProvider, SidepanelSignInCard, useSidepanelSignIn } from "./ExtensionAccess";
import { CLERK_CLIENT_JWT_CACHE_KEY } from "../../access/clerk-client-jwt";

const { auth, instance, setInline, signIn } = vi.hoisted(() => ({
  auth: { isLoaded: false, isSignedIn: false, userId: null },
  instance: { publishableKey: "pk_live_test" },
  setInline: vi.fn(),
  signIn: vi.fn(() => null),
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void) => effect(),
  useState: <T,>(initial: T) => [initial, setInline],
}));
vi.mock("@clerk/chrome-extension", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => auth,
  SignIn: signIn,
}));
vi.mock("../../access/config", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../access/config")>(),
  get CLERK_PUBLISHABLE_KEY() { return instance.publishableKey; },
  CLERK_SIGN_IN_URL: "https://accounts.voltresale.app/sign-in",
  CLERK_SYNC_HOST: "https://clerk.voltresale.app",
}));

beforeEach(() => {
  auth.isLoaded = false;
  auth.isSignedIn = false;
  instance.publishableKey = "pk_live_test";
  setInline.mockClear();
  signIn.mockClear();
});

test("Clerk's own cache writes cannot reload a sidepanel while its session is loading", () => {
  type StorageListener = (changes: Record<string, { newValue: string }>, area: string) => void;
  const listeners: StorageListener[] = [];
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload } });
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://volt${path}` },
    storage: {
      onChanged: {
        addListener: (listener: StorageListener) => listeners.push(listener),
        removeListener: vi.fn(),
      },
    },
  });
  try {
    // SDK JWTHandler.get() persists the sync-host JWT before Clerk is loaded.
    // Every restart repeats that write, so reloading here prevents completion.
    for (let restart = 0; restart < 3; restart += 1) {
      listeners.length = 0;
      renderToStaticMarkup(<SidepanelClerkProvider>Scanner</SidepanelClerkProvider>);
      for (const listener of listeners) {
        listener({ [CLERK_CLIENT_JWT_CACHE_KEY]: { newValue: "existing-client-jwt" } }, "local");
      }
    }
    expect(reload).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a ready signed-out production panel refreshes once for a changed hosted session", () => {
  auth.isLoaded = true;
  const listeners: Array<(changes: Record<string, { oldValue?: string; newValue?: string }>, area: string) => void> = [];
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload } });
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://volt${path}` },
    storage: { onChanged: { addListener: (listener: (typeof listeners)[number]) => listeners.push(listener), removeListener: vi.fn() } },
  });
  try {
    renderToStaticMarkup(<SidepanelClerkProvider>Scanner</SidepanelClerkProvider>);
    expect(listeners).toHaveLength(1);
    const change = (oldValue?: string, newValue?: string) => ({ [CLERK_CLIENT_JWT_CACHE_KEY]: { oldValue, newValue } });
    listeners[0](change("jwt", "jwt"), "local");
    listeners[0](change("jwt", undefined), "local");
    listeners[0](change("jwt", "new-jwt"), "sync");
    expect(reload).not.toHaveBeenCalled();
    listeners[0](change("jwt", "new-jwt"), "local");
    listeners[0](change("new-jwt", "rotated-jwt"), "local");
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

test.each([
  { name: "development inline sign-in", publishableKey: "pk_test_dev", signedIn: false },
  { name: "signed-in production", publishableKey: "pk_live_test", signedIn: true },
])("$name does not reload in response to its own cache writes", ({ publishableKey, signedIn }) => {
  auth.isLoaded = true;
  auth.isSignedIn = signedIn;
  instance.publishableKey = publishableKey;
  const addListener = vi.fn();
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://volt${path}` },
    storage: { onChanged: { addListener, removeListener: vi.fn() } },
  });
  try {
    renderToStaticMarkup(<SidepanelClerkProvider>Scanner</SidepanelClerkProvider>);
    expect(addListener).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("development inline sign-in uses hash routing and hides unsupported social auth", () => {
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `chrome-extension://volt${path}` } });
  try {
    renderToStaticMarkup(<SidepanelSignInCard />);
    expect(signIn).toHaveBeenCalledWith(expect.objectContaining({
      routing: "hash",
      appearance: { elements: { socialButtonsRoot: "hidden", dividerRow: "hidden" } },
    }), undefined);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("production scanner re-sign-in opens a hosted tab; development keeps inline auth", () => {
  const create = vi.fn().mockResolvedValue({});
  vi.stubGlobal("chrome", { tabs: { create } });
  let openSignIn: (() => void) | undefined;
  function SignInTrigger() {
    openSignIn = useSidepanelSignIn().openSignIn;
    return null;
  }
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      renderToStaticMarkup(<SignInTrigger />);
      openSignIn?.();
    }
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith({ url: "https://accounts.voltresale.app/sign-in" });
    expect(setInline).not.toHaveBeenCalled();
    instance.publishableKey = "pk_test_dev";
    renderToStaticMarkup(<SignInTrigger />);
    openSignIn?.();
    expect(setInline).toHaveBeenCalledWith(true);
    expect(create).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
