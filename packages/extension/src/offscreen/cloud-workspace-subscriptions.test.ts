import { beforeEach, expect, test, vi } from "vitest";

// Clerk's session as the offscreen document's Clerk client would read it.
const clerkState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("../access/config", () => ({
  CLERK_PUBLISHABLE_KEY: "pk_test_volt",
  convexDeploymentUrlFromHttpActionsUrl: () => "https://volt.convex.cloud",
}));
vi.mock("./offscreen-storage-cache", () => ({ offscreenStorageCache: {} }));
vi.mock("@clerk/chrome-extension/client", () => ({
  createClerkClient: async () => ({
    session: clerkState.token ? { getToken: async () => clerkState.token } : null,
    organization: null,
  }),
}));
// Like the real client: confirms a token asynchronously, and once it settles
// on noAuth it never asks again unless setAuth is called anew.
vi.mock("convex/browser", () => ({
  ConvexClient: class {
    private sub: string | null = null;
    setAuth(fetcher: () => Promise<string | null>, onChange: (authenticated: boolean) => void) {
      this.sub = null;
      void fetcher().then((token) => {
        this.sub = token ? JSON.parse(atob(token.split(".")[1])).sub : null;
        onChange(this.sub !== null);
      });
    }
    getAuth() { return this.sub ? { token: "", decoded: { sub: this.sub } } : undefined; }
    query = vi.fn(async () => (this.sub ? { shop: "sample.myshopify.com" } : null));
    action = vi.fn();
    mutation = vi.fn();
    onUpdate = vi.fn(() => () => undefined);
  },
}));

const jwt = (sub: string) => `x.${btoa(JSON.stringify({ sub }))}.y`;

beforeEach(() => {
  clerkState.token = null;
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({}), sendMessage: vi.fn(async () => ({ success: true })) } });
});

test("a Shopify request right after signing in waits for the session instead of reporting signed out", async () => {
  const { CloudWorkspaceSubscriptions } = await import("./cloud-workspace-subscriptions");
  // The document starts before the user signs in, so its Convex client settles on noAuth.
  const workspace = new CloudWorkspaceSubscriptions();
  await new Promise((resolve) => setTimeout(resolve, 0));
  clerkState.token = jwt("user_1");
  await expect(workspace.getShopifyConnection()).resolves.toEqual({ shop: "sample.myshopify.com" });
});

test("a signed-out user still gets the sign-in message", async () => {
  const { CloudWorkspaceSubscriptions } = await import("./cloud-workspace-subscriptions");
  const workspace = new CloudWorkspaceSubscriptions();
  await expect(workspace.getShopifyConnection()).rejects.toThrow("Sign in to Volt before connecting Shopify.");
});

test("after signing out, Shopify calls refuse instead of running as the previous account", async () => {
  const { CloudWorkspaceSubscriptions } = await import("./cloud-workspace-subscriptions");
  clerkState.token = jwt("user_1");
  const workspace = new CloudWorkspaceSubscriptions();
  await expect(workspace.getShopifyConnection()).resolves.toEqual({ shop: "sample.myshopify.com" });
  clerkState.token = null;
  await expect(workspace.getShopifyConnection()).rejects.toThrow("Sign in to Volt before connecting Shopify.");
});

test("after switching accounts, Shopify calls wait for the new account", async () => {
  const { CloudWorkspaceSubscriptions } = await import("./cloud-workspace-subscriptions");
  clerkState.token = jwt("user_1");
  const workspace = new CloudWorkspaceSubscriptions();
  await workspace.getShopifyConnection();
  clerkState.token = jwt("user_2");
  await expect(workspace.getShopifyConnection()).resolves.toEqual({ shop: "sample.myshopify.com" });
  // The Convex client was re-armed and now reports the new account.
  expect((workspace as unknown as { acceptedClientSubject: string }).acceptedClientSubject).toBe("user_2");
});
