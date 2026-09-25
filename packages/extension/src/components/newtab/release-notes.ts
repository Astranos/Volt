export const RELEASE_NOTES_VERSION = "1.0.68";

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

export function notesForVersion(version: string) {
  return version === RELEASE_NOTES_VERSION
    ? RELEASE_NOTES
    : [{ title: `Volt ${version} is ready`, description: "Open Settings to review the features and shortcuts available in this release." }];
}
