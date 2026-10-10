import { describe, expect, test, vi } from "vitest";
import { createChromeProfileAuthController } from "./chrome-profile-auth-controller";
import { PROFILE_AUTH_STATE_KEY } from "../access/chrome-profile-auth";
import { CLERK_CLIENT_JWT_CACHE_KEY } from "../access/clerk-client-jwt";

function fixture() {
  const storage: Record<string, unknown> = {};
  let profileId = "google-mi01";
  let listener: (() => void) | null = null;
  const clerk = {
    session: null as { id: string } | null,
    user: null as { id: string } | null,
    client: { signIn: { create: vi.fn(async () => ({ status: "complete", createdSessionId: "session-1" })) } },
    setActive: vi.fn(async () => { clerk.session = { id: "session-1" }; clerk.user = { id: "user-mi01" }; storage[CLERK_CLIENT_JWT_CACHE_KEY] = "native-jwt"; }),
    signOut: vi.fn(async () => { clerk.session = null; clerk.user = null; delete storage[CLERK_CLIENT_JWT_CACHE_KEY]; }),
  };
  const chromeApi = {
    runtime: { id: "extension" },
    identity: {
      getProfileUserInfo: vi.fn(async () => ({ id: profileId, email: "mi01@example.com" })),
      getAuthToken: vi.fn(async () => ({ token: "google-access-token" })),
      removeCachedAuthToken: vi.fn(async () => {}),
      onSignInChanged: { addListener: vi.fn((value: () => void) => { listener = value; }) },
    },
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storage, values); }),
      remove: vi.fn(async (key: string) => { delete storage[key]; }),
    } },
    tabs: { create: vi.fn(async () => ({})) },
  } as unknown as typeof chrome;
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ticket: "one-use-ticket", userId: "user-mi01" })));
  const onChanged = vi.fn();
  const syncWebSession = vi.fn(async () => {});
  const controller = createChromeProfileAuthController({ chromeApi, enabled: true, createClient: async () => clerk, fetcher, onChanged, syncWebSession });
  return { controller, chromeApi, clerk, fetcher, storage, onChanged, syncWebSession, setProfile: (id: string) => { profileId = id; }, profileChanged: () => listener?.() };
}

describe("Chrome profile authentication", () => {
  test("silent startup selects only the primary Chrome account and exchanges a ticket", async () => {
    const f = fixture();
    await f.controller.initialize();
    expect(f.chromeApi.identity.getProfileUserInfo).toHaveBeenCalledWith({ accountStatus: "ANY" });
    expect(f.chromeApi.identity.getAuthToken).toHaveBeenCalledWith({ interactive: false, account: { id: "google-mi01" } });
    expect(f.fetcher.mock.calls[0]).toMatchObject([expect.any(URL), { method: "POST", headers: { Authorization: "Bearer google-access-token" }, body: JSON.stringify({ googleSubject: "google-mi01" }) }]);
    expect(f.clerk.client.signIn.create).toHaveBeenCalledWith({ strategy: "ticket", ticket: "one-use-ticket" });
    expect(f.storage[PROFILE_AUTH_STATE_KEY]).toEqual({ source: "profile", suppressed: false, googleSubject: "google-mi01" });
  });
  test("missing primary profile never falls back to website Google login", async () => {
    const f = fixture(); f.setProfile("");
    expect(await f.controller.signIn(true)).toEqual({ success: false, error: "chrome_profile_signed_out" });
    expect(f.chromeApi.identity.getAuthToken).not.toHaveBeenCalled();
  });
  test("enabling profile authentication clears an unbound hosted cache when Chrome is signed out", async () => {
    const f = fixture(); f.setProfile("");
    f.clerk.session = { id: "legacy-hosted-session" };
    f.storage[CLERK_CLIENT_JWT_CACHE_KEY] = "legacy-jwt";
    expect(await f.controller.signIn()).toMatchObject({ error: "chrome_profile_signed_out" });
    expect(f.clerk.session).toBeNull();
    expect(f.storage[CLERK_CLIENT_JWT_CACHE_KEY]).toBeUndefined();
  });
  test("queued interactive retries cannot override a later deliberate sign-out", async () => {
    const f = fixture();
    let release: (() => void) | undefined;
    f.fetcher.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return new Response(JSON.stringify({ code: "invalid_google_token" }), { status: 401 }); });
    const silent = f.controller.signIn();
    await vi.waitFor(() => expect(release).toBeDefined());
    const interactive = f.controller.signIn(true);
    const signOut = f.controller.signOut();
    release?.(); await Promise.all([silent, interactive, signOut]);
    expect(f.storage[PROFILE_AUTH_STATE_KEY]).toMatchObject({ suppressed: true });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.clerk.session).toBeNull();
  });
  test("simultaneous silent requests share one exchange", async () => {
    const f = fixture();
    await Promise.all([f.controller.signIn(), f.controller.signIn(), f.controller.signIn()]);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  test("deliberate sign-out revokes local session and suppresses automatic sign-in", async () => {
    const f = fixture(); await f.controller.signIn(); await f.controller.signOut();
    expect(await f.controller.signIn()).toEqual({ success: false, error: "automatic_sign_in_disabled" });
    expect(f.storage[CLERK_CLIENT_JWT_CACHE_KEY]).toBeUndefined();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(await f.controller.signIn(true)).toEqual({ success: true });
    expect(f.chromeApi.identity.getAuthToken).toHaveBeenLastCalledWith({ interactive: true, account: { id: "google-mi01" } });
  });
  test("sign-out clears local credentials even when remote revocation fails", async () => {
    const f = fixture(); await f.controller.signIn();
    f.clerk.signOut.mockRejectedValueOnce(new Error("network unavailable"));
    expect(await f.controller.signOut()).toEqual({ success: true });
    expect(f.storage[CLERK_CLIENT_JWT_CACHE_KEY]).toBeUndefined();
    expect(f.storage[PROFILE_AUTH_STATE_KEY]).toMatchObject({ suppressed: true });
    expect(f.onChanged).toHaveBeenCalledTimes(2);
  });
  test("manual fallback revokes native session then imports hosted session and opens a tab", async () => {
    const f = fixture(); await f.controller.signIn(); await f.controller.manualSignIn();
    expect(f.storage[PROFILE_AUTH_STATE_KEY]).toMatchObject({ source: "web", suppressed: true });
    expect(f.syncWebSession).toHaveBeenCalledOnce();
    expect(f.clerk.signOut).toHaveBeenCalled();
    expect(f.chromeApi.tabs.create).toHaveBeenCalledOnce();
    expect((await f.controller.signIn()).success).toBe(false);
  });
  test("profile removal invalidates the old native session", async () => {
    const f = fixture(); await f.controller.signIn(); f.setProfile("");
    expect(await f.controller.signIn()).toMatchObject({ error: "chrome_profile_signed_out" });
    expect(f.clerk.session).toBeNull();
    expect(f.storage[CLERK_CLIENT_JWT_CACHE_KEY]).toBeUndefined();
  });
  test("profile changes during activation revoke the newly created session", async () => {
    const f = fixture();
    f.clerk.setActive.mockImplementationOnce(async () => { f.clerk.session = { id: "old-profile-session" }; f.setProfile("google-mi03"); });
    expect(await f.controller.signIn()).toEqual({ success: false, error: "chrome_profile_changed" });
    expect(f.clerk.session).toBeNull();
    expect(f.storage[PROFILE_AUTH_STATE_KEY]).toBeUndefined();
  });
  test("postactivation account changes still clear credentials when revocation fails", async () => {
    const f = fixture();
    f.clerk.setActive.mockImplementationOnce(async () => {
      f.clerk.session = { id: "old-profile-session" };
      f.storage[CLERK_CLIENT_JWT_CACHE_KEY] = "old-jwt";
      f.setProfile("google-mi03");
    });
    f.clerk.signOut.mockRejectedValueOnce(new Error("revocation unavailable"));
    expect(await f.controller.signIn()).toEqual({ success: false, error: "chrome_profile_changed" });
    expect(f.storage[CLERK_CLIENT_JWT_CACHE_KEY]).toBeUndefined();
    expect(f.onChanged).toHaveBeenCalledOnce();
  });
  test("new sign-in cannot race an in-progress sign-out or manual transition", async () => {
    const f = fixture(); await f.controller.signIn();
    let release: (() => void) | undefined;
    f.clerk.signOut.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); });
    const signOut = f.controller.signOut();
    const manual = f.controller.manualSignIn();
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(await f.controller.signIn(true)).toEqual({ success: false, error: "authentication_transition_in_progress" });
    expect(f.syncWebSession).not.toHaveBeenCalled();
    release?.(); await Promise.all([signOut, manual]);
    expect(f.storage[PROFILE_AUTH_STATE_KEY]).toMatchObject({ source: "web", suppressed: true });
    expect(f.syncWebSession).toHaveBeenCalledOnce();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  test("profile change while an exchange is pending retries after invalidating the old attempt", async () => {
    const f = fixture(); await f.controller.initialize();
    await f.controller.signOut();
    let release: (() => void) | undefined;
    f.fetcher.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return new Response(JSON.stringify({ ticket: "old-ticket", userId: "user-mi01" })); });
    const pending = f.controller.signIn(true);
    await vi.waitFor(() => expect(release).toBeDefined());
    f.setProfile("google-mi03"); f.profileChanged(); release?.();
    expect(await pending).toEqual({ success: false, error: "chrome_profile_changed" });
    await vi.waitFor(() => expect(f.storage[PROFILE_AUTH_STATE_KEY]).toMatchObject({ googleSubject: "google-mi03" }));
    expect(f.chromeApi.identity.getAuthToken).toHaveBeenLastCalledWith({ interactive: false, account: { id: "google-mi03" } });
  });
  test("backend errors retain manual fallback without accepting a ticket", async () => {
    const f = fixture(); f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: "mfa_required" }), { status: 403 }));
    expect(await f.controller.signIn()).toEqual({ success: false, error: "mfa_required" });
    expect(f.clerk.setActive).not.toHaveBeenCalled();
  });
  test("expired Google credentials are removed from the token cache", async () => {
    const f = fixture(); f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: "invalid_google_token" }), { status: 401 }));
    await f.controller.signIn();
    expect(f.chromeApi.identity.removeCachedAuthToken).toHaveBeenCalledWith({ token: "google-access-token" });
  });
  test("content scripts cannot start or stop profile authentication", () => {
    const f = fixture(); const respond = vi.fn();
    expect(f.controller.handleMessage({ action: "chromeProfileSignOut" }, { id: "extension", url: "https://admin.shopify.com" }, respond)).toBe(true);
    expect(respond).toHaveBeenCalledWith({ success: false, error: "unauthorized_extension_sender" });
    expect(f.clerk.signOut).not.toHaveBeenCalled();
  });
});
