import {
  CLERK_CLIENT_JWT_CACHE_KEY,
  CLERK_CLIENT_JWT_COOKIE,
} from "../access/clerk-client-jwt";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "../access/config";

type MirrorOptions = {
  chromeApi: typeof chrome;
  log: (...args: unknown[]) => void;
  onChanged: () => void;
};

/*
 * The Convex subscription lives in the offscreen document, which gets a reduced
 * extension API surface with no chrome.cookies — so Clerk's syncHost handshake
 * can never run there and the workspace used to stay signed in only while the
 * sidepanel was open to hand it a token.
 *
 * The service worker does have chrome.cookies, so it mirrors the account's
 * client JWT into the storage cache Clerk reads when it cannot sync itself.
 * With that in place the phone and Chrome are simply on the same Clerk session,
 * and nothing has to be connected or kept open for captures to arrive.
 */
export function createClerkSessionMirror({ chromeApi, log, onChanged }: MirrorOptions) {
  const enabled = Boolean(CLERK_PUBLISHABLE_KEY);

  async function sync() {
    if (!enabled || !chromeApi.cookies) return;
    let value: string | null = null;
    try {
      const cookie = await chromeApi.cookies.get({
        url: CLERK_SYNC_HOST,
        name: CLERK_CLIENT_JWT_COOKIE,
      });
      value = cookie?.value ?? null;
    } catch (error) {
      // An unreadable cookie is not a sign-out; leave the cached JWT alone so a
      // transient failure cannot log the workspace out.
      log("Failed to read the Clerk session cookie", error);
      return;
    }

    const stored = await chromeApi.storage.local.get(CLERK_CLIENT_JWT_CACHE_KEY);
    if ((stored[CLERK_CLIENT_JWT_CACHE_KEY] ?? null) === value) return;
    if (value) {
      await chromeApi.storage.local.set({ [CLERK_CLIENT_JWT_CACHE_KEY]: value });
    } else {
      await chromeApi.storage.local.remove(CLERK_CLIENT_JWT_CACHE_KEY);
    }
    onChanged();
  }

  return {
    sync,
    initialize: () => {
      if (!enabled) return;
      // Signing in or out on the web app rewrites this cookie, which is the only
      // signal the service worker gets that the account changed.
      chromeApi.cookies?.onChanged.addListener((change) => {
        if (change.cookie.name !== CLERK_CLIENT_JWT_COOKIE) return;
        void sync();
      });
      void sync();
    },
  };
}
