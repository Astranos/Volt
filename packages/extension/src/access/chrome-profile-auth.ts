export const PROFILE_AUTH_STATE_KEY = "volt.chromeProfileAuth";
export const PROFILE_AUTH_EVENT_KEY = "volt.chromeProfileAuth.sessionChanged";
export const GOOGLE_CHROME_EXTENSION_CLIENT_ID =
  import.meta.env?.WXT_GOOGLE_CHROME_EXTENSION_CLIENT_ID?.trim() ?? "";
export const CHROME_PROFILE_AUTH_ENABLED = Boolean(GOOGLE_CHROME_EXTENSION_CLIENT_ID);

export type ProfileAuthState = {
  source: "profile" | "web";
  suppressed: boolean;
  googleSubject: string | null;
};

export function profileAuthState(value: unknown): ProfileAuthState {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    source: record.source === "web" ? "web" : "profile",
    suppressed: record.suppressed === true,
    googleSubject: typeof record.googleSubject === "string" ? record.googleSubject : null,
  };
}

// The service worker owns auth-source transitions and cookie imports. Serializing
// them keeps a cookie read begun in web mode from overwriting a native login.
let transition: Promise<unknown> = Promise.resolve();
export function withProfileAuthStateLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = transition.then(operation, operation);
  transition = next.catch(() => undefined);
  return next;
}
