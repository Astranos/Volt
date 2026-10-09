import { CLERK_PUBLISHABLE_KEY, CLERK_SIGN_IN_URL } from "../access/config";
import { CLERK_CLIENT_JWT_CACHE_KEY } from "../access/clerk-client-jwt";
import { CHROME_PROFILE_AUTH_ENABLED, PROFILE_AUTH_EVENT_KEY, PROFILE_AUTH_STATE_KEY, profileAuthState, withProfileAuthStateLock, type ProfileAuthState } from "../access/chrome-profile-auth";
import { isTrustedExtensionPageSender, type ExtensionMessageSender } from "../access/sender-policy";
import { EXTENSION_SCANNER_SIGNAL_URL } from "../domain/mobile-scanner-signal-url";

type NativeClerk = {
  session: { id: string } | null | undefined;
  user: { id: string } | null | undefined;
  client: { signIn: { create(args: { strategy: "ticket"; ticket: string }): Promise<{ status: string | null; createdSessionId: string | null }> } } | null | undefined;
  setActive(args: { session: string }): Promise<void>;
  signOut(): Promise<void>;
};
type Result = { success: true } | { success: false; error: string };
type Options = {
  chromeApi: typeof chrome;
  onChanged: () => void;
  enabled?: boolean;
  fetcher?: typeof fetch;
  createClient?: () => Promise<NativeClerk>;
  syncWebSession?: () => Promise<void>;
};

export function createChromeProfileAuthController({ chromeApi, onChanged, enabled = CHROME_PROFILE_AUTH_ENABLED, fetcher = fetch, syncWebSession = async () => {}, createClient = async () => {
  const { createClerkClient } = await import("@clerk/chrome-extension/client");
  return createClerkClient({ publishableKey: CLERK_PUBLISHABLE_KEY, background: true });
} }: Options) {
  let pending: Promise<Result> | null = null;
  let epoch = 0;
  let transitions = 0;
  let transitionTail: Promise<void> = Promise.resolve();
  function runTransition(operation: () => Promise<Result>): Promise<Result> {
    transitions++;
    const result = transitionTail.then(operation);
    transitionTail = result.then(() => undefined, () => undefined);
    return result.finally(() => { transitions--; });
  }
  async function state() {
    const stored = await chromeApi.storage.local.get(PROFILE_AUTH_STATE_KEY);
    return profileAuthState(stored[PROFILE_AUTH_STATE_KEY]);
  }
  async function save(value: ProfileAuthState) {
    await withProfileAuthStateLock(() => chromeApi.storage.local.set({ [PROFILE_AUTH_STATE_KEY]: value }));
  }
  async function changed() {
    await chromeApi.storage.local.set({ [PROFILE_AUTH_EVENT_KEY]: crypto.randomUUID() });
    onChanged();
  }
  async function clearSession(notify = true, activeClient?: NativeClerk) {
    try {
      const clerk = activeClient ?? await createClient();
      await clerk.signOut();
    } catch {
      // Losing network access must not retain another store's local credential.
      // Revocation is best effort; no token-bearing vendor error is logged.
    } finally {
      await chromeApi.storage.local.remove(CLERK_CLIENT_JWT_CACHE_KEY);
      if (notify) await changed();
    }
  }
  async function attempt(interactive: boolean): Promise<Result> {
    if (!enabled || !chromeApi.identity) return { success: false, error: "not_configured" };
    const currentEpoch = epoch;
    let current = await state();
    if (!interactive && (current.suppressed || current.source === "web")) return { success: false, error: "automatic_sign_in_disabled" };
    if (interactive) {
      current = { ...current, source: "profile", suppressed: false };
      await save(current);
    }
    // Never let getAuthToken fall back to a Google account merely signed into a website.
    const profile = await chromeApi.identity.getProfileUserInfo({ accountStatus: "ANY" });
    if (current.googleSubject && current.googleSubject !== profile.id) {
      // A native session belongs to one primary Chrome profile account.
      await clearSession();
      current = { ...current, googleSubject: null };
      await save(current);
    }
    if (!profile.id) {
      if (!current.googleSubject) {
        const stored = await chromeApi.storage.local.get(CLERK_CLIENT_JWT_CACHE_KEY);
        if (stored[CLERK_CLIENT_JWT_CACHE_KEY]) await clearSession();
      }
      return { success: false, error: "chrome_profile_signed_out" };
    }
    const clerk = await createClient();
    if (clerk.session && current.googleSubject === profile.id) return { success: true };
    if (clerk.session) {
      await clearSession(true, clerk);
    }
    const { token } = await chromeApi.identity.getAuthToken({ interactive, account: { id: profile.id } });
    if (!token) return { success: false, error: "google_authorization_required" };
    const response = await fetcher(new URL("/auth/chrome-profile", EXTENSION_SCANNER_SIGNAL_URL), {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ googleSubject: profile.id }), signal: AbortSignal.timeout(45_000),
    });
    const body: unknown = await response.json();
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    if (!response.ok) {
      if (response.status === 401) await chromeApi.identity.removeCachedAuthToken({ token });
      return { success: false, error: typeof record.code === "string" ? record.code : "profile_auth_failed" };
    }
    if (typeof record.ticket !== "string" || typeof record.userId !== "string") return { success: false, error: "invalid_auth_response" };
    const profileNow = await chromeApi.identity.getProfileUserInfo({ accountStatus: "ANY" });
    if (epoch !== currentEpoch || profileNow.id !== profile.id) return { success: false, error: "chrome_profile_changed" };
    if (!clerk.client) return { success: false, error: "clerk_unavailable" };
    const signIn = await clerk.client.signIn.create({ strategy: "ticket", ticket: record.ticket });
    if (signIn.status !== "complete" || !signIn.createdSessionId) return { success: false, error: "additional_sign_in_required" };
    if (epoch !== currentEpoch) { await clearSession(true, clerk); return { success: false, error: "chrome_profile_changed" }; }
    await clerk.setActive({ session: signIn.createdSessionId });
    const activatedProfile = await chromeApi.identity.getProfileUserInfo({ accountStatus: "ANY" });
    if (epoch !== currentEpoch || activatedProfile.id !== profile.id) {
      await clearSession(true, clerk);
      return { success: false, error: "chrome_profile_changed" };
    }
    if (clerk.user?.id !== record.userId) { await clearSession(true, clerk); return { success: false, error: "account_mismatch" }; }
    await save({ source: "profile", suppressed: false, googleSubject: profile.id });
    await changed();
    return { success: true };
  }
  function signIn(interactive = false): Promise<Result> {
    if (transitions > 0) return Promise.resolve({ success: false, error: "authentication_transition_in_progress" });
    if (pending) {
      const requestedEpoch = epoch;
      return interactive ? pending.then(result => epoch !== requestedEpoch
        ? { success: false, error: "chrome_profile_changed" }
        : result.success ? result : signIn(true)) : pending;
    }
    pending = attempt(interactive).catch((): Result => ({ success: false, error: "google_authorization_required" })).finally(() => { pending = null; });
    return pending;
  }
  function signOut(): Promise<Result> {
    epoch++;
    return runTransition(async () => {
      await save({ source: "profile", suppressed: true, googleSubject: null });
      await pending;
      await clearSession();
      return { success: true };
    });
  }
  function manualSignIn(): Promise<Result> {
    epoch++;
    return runTransition(async () => {
      await pending;
      await save({ source: "profile", suppressed: true, googleSubject: null });
      await clearSession(false);
      await save({ source: "web", suppressed: true, googleSubject: null });
      await syncWebSession();
      await changed();
      await chromeApi.tabs.create({ url: CLERK_SIGN_IN_URL });
      return { success: true };
    });
  }
  return {
    signIn, signOut, manualSignIn,
    initialize: async () => {
      if (!enabled) return;
      chromeApi.identity?.onSignInChanged.addListener(() => { epoch++; void Promise.resolve(pending).then(() => signIn()); });
      await signIn();
    },
    handleMessage(raw: unknown, sender: ExtensionMessageSender, respond: (result: Result) => void) {
      const action = raw && typeof raw === "object" ? (raw as Record<string, unknown>).action : null;
      if (action !== "chromeProfileSignIn" && action !== "chromeProfileSignOut" && action !== "chromeProfileManualSignIn") return false;
      if (!isTrustedExtensionPageSender(sender, chromeApi.runtime.id, ["/newtab.html", "/sidepanel.html", "/options.html", "/mobile-scanner-popup.html"])) {
        respond({ success: false, error: "unauthorized_extension_sender" }); return true;
      }
      const operation = action === "chromeProfileSignIn" ? signIn(true) : action === "chromeProfileSignOut" ? signOut() : manualSignIn();
      void operation.then(respond).catch(() => respond({ success: false, error: "profile_auth_failed" }));
      return true;
    },
  };
}
