const extensionEnv = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;

export const CLERK_PUBLISHABLE_KEY =
  extensionEnv?.WXT_CLERK_PUBLISHABLE_KEY?.trim() ?? "";

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

// Sync from the web app origin where users complete Clerk sign-in, not the
// Frontend API host decoded from the publishable key.
export const CLERK_SYNC_HOST =
  extensionEnv?.WXT_CLERK_SYNC_HOST?.trim() || "https://volt.juanquenga.com";

export const CLERK_SIGN_IN_URL =
  extensionEnv?.WXT_CLERK_SIGN_IN_URL?.trim() ||
  "https://accounts.volt.juanquenga.com/sign-in";

export const VOLT_FULL_APP_URL =
  extensionEnv?.WXT_VOLT_FULL_APP_URL?.trim() ||
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
