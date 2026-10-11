import { describe, expect, test, vi } from "vitest";
import { createChromeProfileAuthController } from "./chrome-profile-auth-controller";
import { createProfileClerkProxy, PROFILE_CLERK_OFFSCREEN_ACTION, type ProfileClerkClient } from "../access/profile-clerk-client";
import { createProfileClerkOffscreenController } from "../offscreen/profile-clerk-controller";

const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const worker = { id: extensionId, url: `chrome-extension://${extensionId}/background.js` };

function fixture() {
  const clerk: ProfileClerkClient = {
    session: null, user: null,
    client: { signIn: { create: vi.fn(async () => ({ status: "complete", createdSessionId: "session-profile" })) } },
    setActive: vi.fn(async ({ session }) => { clerk.session = { id: session }; clerk.user = { id: "user-profile" }; }),
    signOut: vi.fn(async () => { clerk.session = null; clerk.user = null; }),
  };
  const createClient = vi.fn(async () => clerk);
  const offscreen = createProfileClerkOffscreenController({ extensionId, createClient });
  const send = vi.fn((message: unknown) => new Promise<unknown>((resolve, reject) => {
    if (!offscreen.handleMessage(message, worker, resolve)) reject(new Error("Unhandled offscreen message"));
  }));
  const stored: Record<string, unknown> = {};
  const chromeApi = {
    identity: {
      getProfileUserInfo: vi.fn(async () => ({ id: "google-profile" })),
      getAuthToken: vi.fn(async () => ({ token: "google-token" })),
      removeCachedAuthToken: vi.fn(),
    },
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, value); }),
      remove: vi.fn(async (key: string) => { delete stored[key]; }),
    } },
  } as unknown as typeof chrome;
  const controller = createChromeProfileAuthController({
    chromeApi, enabled: true, onChanged: vi.fn(), sendOffscreenMessage: send,
    fetcher: vi.fn(async () => new Response(JSON.stringify({ ticket: "one-use-ticket", userId: "user-profile" }))),
  });
  return { clerk, controller, offscreen, send, createClient };
}

describe("Chrome profile auth through the offscreen document", () => {
  test("the default worker client redeems a ticket and activates the verified account remotely", async () => {
    const f = fixture();
    expect(await f.controller.signIn(true)).toEqual({ success: true });
    expect(f.clerk.client?.signIn.create).toHaveBeenCalledWith({ strategy: "ticket", ticket: "one-use-ticket" });
    expect(f.clerk.setActive).toHaveBeenCalledWith({ session: "session-profile" });
    expect(f.send.mock.calls.map(([raw]) => (raw as { operation: string }).operation)).toEqual(["snapshot", "createSignIn", "setActive"]);
    await f.controller.signOut();
    expect(f.clerk.signOut).toHaveBeenCalledOnce();
    expect(await f.controller.signIn()).toMatchObject({ error: "automatic_sign_in_disabled" });
  });

  test("account mismatch signs out the remotely activated session", async () => {
    const f = fixture();
    vi.mocked(f.clerk.setActive).mockImplementation(async () => { f.clerk.session = { id: "wrong-session" }; f.clerk.user = { id: "another-user" }; });
    expect(await f.controller.signIn(true)).toMatchObject({ error: "account_mismatch" });
    expect(f.clerk.signOut).toHaveBeenCalledOnce();
    expect(f.clerk.session).toBeNull();
  });

  test.each([
    { id: "another-extension", url: worker.url },
    { ...worker, tab: { id: 1 } },
    { id: extensionId, url: `chrome-extension://${extensionId}/newtab.html` },
    { id: extensionId, url: "https://example.com" },
  ])("rejects auth mutations from non-worker senders %j", (sender) => {
    const f = fixture();
    const respond = vi.fn();
    expect(f.offscreen.handleMessage({ action: PROFILE_CLERK_OFFSCREEN_ACTION, operation: "signOut" }, sender, respond)).toBe(true);
    expect(respond).toHaveBeenCalledWith({ success: false, error: "unauthorized_extension_sender" });
    expect(f.createClient).not.toHaveBeenCalled();
    expect(f.clerk.signOut).not.toHaveBeenCalled();
  });

  test("a missing offscreen response fails instead of claiming sign-in succeeded", async () => {
    await expect(createProfileClerkProxy(async () => ({ success: false }))).rejects.toThrow("did not respond");
  });

  test("invalid session operations return an error without activating a session", async () => {
    const f = fixture();
    await expect(f.send({ action: PROFILE_CLERK_OFFSCREEN_ACTION, operation: "setActive", session: 7 })).resolves.toEqual({ success: false, error: "profile_auth_failed" });
    expect(f.clerk.setActive).not.toHaveBeenCalled();
  });
});
