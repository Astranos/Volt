/**
 * The release these notes announce. The new tab opens "What's new" once for
 * anyone who last saw an older version. Bug-fix releases leave this alone so
 * they update quietly; to announce one, rewrite the notes and set this to the
 * version being shipped (or the next version after the current store version).
 */
export const RELEASE_NOTES_VERSION = "1.0.69";

export const RELEASE_NOTES = [
  {
    title: "Shopify products in your new tab",
    description: "Search your connected store without leaving Volt. In-stock products appear first, with photos, prices, SKU, and condition when available.",
  },
  {
    title: "Review yesterday’s listings",
    description: "The Audit button opens yesterday’s Shopify products together in a tab group, including drafts and unpublished listings.",
  },
  {
    title: "Make text actions yours",
    description: "Choose and reorder up to three shortcuts for highlighted text and the right-click menu. You can also add a custom icon, label, and URL.",
  },
  {
    title: "Settings follow your account",
    description: "Sign in with your Volt account to sync extension settings across computers.",
  },
] as const;

export const RELEASE_SETTINGS_LINKS = [
  { label: "Connect Shopify", hash: "shopify-audit" },
  { label: "Selected text actions", hash: "selection-actions" },
  { label: "Context menu", hash: "contextmenu" },
] as const;

function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/** First run, or the user hasn't seen the release these notes announce. */
export function shouldAnnounceRelease(seenVersion: unknown) {
  return typeof seenVersion !== "string" || compareVersions(seenVersion, RELEASE_NOTES_VERSION) < 0;
}
