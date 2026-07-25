import {
  CLERK_PUBLISHABLE_KEY,
  clerkFrontendApiHostFromPublishableKey,
} from "./config";

// Clerk's chrome-extension SDK caches the client JWT — the credential that
// identifies the signed-in browser to the Frontend API — in chrome.storage.local
// under this key, and reads it whenever it cannot sync from a cookie itself.
// Every Volt surface that runs Clerk shares one account through it.
const STORAGE_KEY_CLIENT_JWT = "__clerk_client_jwt";
const STORAGE_KEY_VERSION = "v2";

export const CLERK_CLIENT_JWT_COOKIE = "__client";

export function clerkClientJwtCacheKey(frontendApiHost: string) {
  return [frontendApiHost, STORAGE_KEY_CLIENT_JWT, STORAGE_KEY_VERSION].join("|");
}

export const CLERK_CLIENT_JWT_CACHE_KEY = clerkClientJwtCacheKey(
  clerkFrontendApiHostFromPublishableKey(CLERK_PUBLISHABLE_KEY),
);
