import { buildSearchUrl, SEARCH_URL_TEMPLATES } from "./search.ts";

export const SELECTION_ACTIONS = [
  { id: "ebay", label: "eBay Prices" },
  { id: "google-upc", label: "Search for UPC" },
  { id: "pricecharting", label: "PriceCharting" },
  { id: "google-search", label: "Search Google" },
  { id: "copy-highlight-link", label: "Copy link to highlight" },
  { id: "look-up", label: "Look up text" },
  { id: "ask-gemini", label: "Ask Gemini" },
] as const;

export type SelectionActionId = (typeof SELECTION_ACTIONS)[number]["id"];

export const DEFAULT_POPUP_ACTIONS: SelectionActionId[] = [
  "ebay",
  "google-upc",
  "pricecharting",
];

export const DEFAULT_CONTEXT_ACTIONS: SelectionActionId[] = [
  "ebay",
  "google-upc",
  "pricecharting",
];

const validActionIds = new Set<string>(SELECTION_ACTIONS.map((action) => action.id));

export function normalizeSelectionActions(
  value: unknown,
  fallback: readonly SelectionActionId[],
): SelectionActionId[] {
  if (!Array.isArray(value)) return [...fallback];
  const result: SelectionActionId[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !validActionIds.has(entry)) continue;
    const action = SELECTION_ACTIONS.find((candidate) => candidate.id === entry);
    if (action && !result.includes(action.id)) result.push(action.id);
    if (result.length === 3) break;
  }
  return result;
}

export function selectionActionLabel(id: SelectionActionId): string {
  return SELECTION_ACTIONS.find((action) => action.id === id)?.label ?? id;
}

export function selectionActionUrl(id: SelectionActionId, text: string): string | null {
  const encoded = encodeURIComponent(text);
  switch (id) {
    case "ebay":
      return buildSearchUrl(SEARCH_URL_TEMPLATES.ebay, text);
    case "google-upc":
      return `https://www.google.com/search?q=${encodeURIComponent(`UPC for ${text}`)}`;
    case "pricecharting":
      return buildSearchUrl(SEARCH_URL_TEMPLATES.pricecharting, text);
    case "google-search":
      return `https://www.google.com/search?q=${encoded}`;
    case "look-up":
      return `https://www.google.com/search?q=${encodeURIComponent(`define ${text}`)}`;
    case "ask-gemini":
    case "copy-highlight-link":
      return null;
  }
}

export function linkToTextHighlight(pageUrl: string, selectedText: string): string | null {
  const text = selectedText.replace(/\s+/g, " ").trim();
  if (!text) return null;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const existingFragment = url.hash.slice(1).split(":~:")[0];
    url.hash = `${existingFragment}:~:text=${encodeURIComponent(text)}`;
    return url.href;
  } catch {
    return null;
  }
}
