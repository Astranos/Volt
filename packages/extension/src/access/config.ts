export const CLERK_PUBLISHABLE_KEY =
  import.meta.env?.WXT_CLERK_PUBLISHABLE_KEY?.trim() ?? "";

export function clerkFrontendApiFromPublishableKey(
  publishableKey: string,
): string {
  const encodedHost = publishableKey.split("_").slice(2).join("_");
  if (!encodedHost) return "";
  try {
    const decodedHost = atob(encodedHost)
      .replace(/\0+$/g, "")
      .replace(/\$$/, "");
    const frontendApi = new URL(
      decodedHost.includes("://") ? decodedHost : `https://${decodedHost}`,
    );
    return frontendApi.protocol === "https:" ? frontendApi.origin : "";
  } catch {
    return "";
  }
}

// Clerk keys its storage cache by the bare Frontend API host, not the origin.
export function clerkFrontendApiHostFromPublishableKey(
  publishableKey: string,
): string {
  const origin = clerkFrontendApiFromPublishableKey(publishableKey);
  return origin ? new URL(origin).host : "";
}

export const CLERK_SIGN_IN_URL =
  import.meta.env?.WXT_CLERK_SIGN_IN_URL?.trim() ||
  "https://accounts.voltresale.app/sign-in";

// Test instances store the dev-browser JWT on the web app host. Production
// instances store __client on the Frontend API host.
export function clerkSyncHost(
  publishableKey: string,
  signInUrl: string,
  override = "",
): string {
  if (override.trim()) return override.trim();
  if (publishableKey.startsWith("pk_test_")) return new URL(signInUrl).origin;
  return (
    clerkFrontendApiFromPublishableKey(publishableKey) ||
    "https://clerk.voltresale.app"
  );
}

export function clerkClientJwtCookieName(publishableKey: string): string {
  return publishableKey.startsWith("pk_test_") ? "__clerk_db_jwt" : "__client";
}

export const CLERK_SYNC_HOST = clerkSyncHost(
  CLERK_PUBLISHABLE_KEY,
  CLERK_SIGN_IN_URL,
  import.meta.env?.WXT_CLERK_SYNC_HOST ?? "",
);

export const VOLT_FULL_APP_URL =
  import.meta.env?.WXT_VOLT_FULL_APP_URL?.trim() ||
  "https://apps.apple.com/us/app/volt-scanner/id6771770148";

export function convexDeploymentUrlFromHttpActionsUrl(httpActionsUrl: string) {
  const url = new URL(httpActionsUrl);
  if (!url.hostname.endsWith(".convex.site")) {
    throw new Error("Convex HTTP Actions URL must use a .convex.site host.");
  }
  url.hostname = `${url.hostname.slice(0, -".convex.site".length)}.convex.cloud`;
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}
