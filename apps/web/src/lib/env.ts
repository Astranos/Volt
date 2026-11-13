import {
  SCANNER_SIGNAL_URL_DEV,
  SCANNER_SIGNAL_URL_PROD,
} from "@volt/scanner-protocol";

/**
 * Clerk publishable keys are public by design, but the value still has to be
 * baked in at build time. Vercel needs `VITE_CLERK_PUBLISHABLE_KEY` set on the
 * project; local development reads it from `apps/web/.env.local`.
 */
export const CLERK_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

/**
 * The Convex deployment is picked the same way every other Volt client picks
 * it: production builds talk to the production deployment, everything else
 * talks to the development one. Both halves of a test have to agree, so
 * `VITE_CONVEX_URL` stays available as an escape hatch for pointing a local
 * dev server at production data.
 */
export const CONVEX_URL: string =
  import.meta.env.VITE_CONVEX_URL ??
  convexDeploymentUrl(
    import.meta.env.PROD ? SCANNER_SIGNAL_URL_PROD : SCANNER_SIGNAL_URL_DEV,
  );

/** The websocket client wants `*.convex.cloud`, not the HTTP-actions host. */
function convexDeploymentUrl(httpActionsUrl: string) {
  const url = new URL(httpActionsUrl);
  const suffix = ".convex.site";
  if (!url.hostname.endsWith(suffix)) {
    throw new Error("Convex HTTP Actions URL must use a .convex.site host.");
  }
  url.hostname = `${url.hostname.slice(0, -suffix.length)}.convex.cloud`;
  return url.origin;
}
