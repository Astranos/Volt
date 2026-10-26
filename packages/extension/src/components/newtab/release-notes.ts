/**
 * The release these notes announce. The new tab opens "What's new" once for
 * anyone who last saw an older version. Leave this alone to update the notes
 * quietly: the "What's new in Volt" link just gets an unread dot. To announce a
 * release, set this to the version being shipped (or the next version after the
 * current store version). New installs never get the popup.
 */
export const RELEASE_NOTES_VERSION = "1.0.69";

export const RELEASE_NOTES = [
  {
    title: "Write notes like a document",
    description: "Handbook pages are now called notes, and you edit them as they'll look. Type / for headings, lists, and checklists, or select text to make it bold, italic, or a link. The line under an entry's title is now called a comment.",
  },
  {
    title: "Pinned entries come first",
    description: "Pinned handbook entries have their own section at the top of the handbook and the side panel. Unpin one and it goes back to its category.",
  },
  {
    title: "Know when an update is ready",
    description: "When Chrome has downloaded a new version of Volt, the new tab shows Update ready. Click it to restart Volt and get the update right away.",
  },
  {
    title: "Clearer logins, and several values per entry",
    description: "Logins show the username and password on their own rows, each with Copy. Quick values can hold several things to copy, like a store's phone, address, and email.",
  },
  {
    title: "Put categories in your order",
    description: "Move handbook categories up or down on the full handbook page. The side panel follows the same order.",
  },
  {
    title: "Handbook pages",
    description: "Write checklists, policies, and how-tos with headings, lists, and links. Short pages can show in full right in the side panel.",
  },
  {
    title: "Phone numbers and addresses format themselves",
    description: "Phone numbers get their dashes as you type. Addresses are entered as street, city, state, and ZIP, show on two lines, and open in Maps.",
  },
  {
    title: "Store handbook",
    description: "Keep your store's phone, address, logins, and setup guides in one place. Open it from the side panel, or search it from the new tab. Logins stay hidden until you reveal them.",
  },
  {
    title: "Connect more than one Shopify store",
    description: "Link up to five stores to one Volt account, then switch stores in new tab search, the audit, and settings.",
  },
  {
    title: "Faster scanner results",
    description: "The scanner side panel loads your cloud results faster.",
  },
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

export const WHATS_NEW_SEEN_VERSION_KEY = "voltWhatsNewSeenVersion";
export const WHATS_NEW_SEEN_NOTES_KEY = "voltWhatsNewSeenNotes";
/** Changes whenever a note is added or retitled; drives the unread dot. */
export const RELEASE_NOTES_ID = RELEASE_NOTES.map((note) => note.title).join("\n");

export function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/** The user hasn't seen the release these notes announce. */
export function shouldAnnounceRelease(seenVersion: unknown) {
  return typeof seenVersion !== "string" || compareVersions(seenVersion, RELEASE_NOTES_VERSION) < 0;
}

/** Stored on install so a brand-new user isn't shown notes for changes they never saw. */
export function markReleaseNotesSeen(version: string) {
  return chrome.storage.local.set({ [WHATS_NEW_SEEN_VERSION_KEY]: version, [WHATS_NEW_SEEN_NOTES_KEY]: RELEASE_NOTES_ID });
}
