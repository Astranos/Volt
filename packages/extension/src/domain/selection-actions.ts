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
export type CustomSelectionAction = {
  kind: "custom";
  id: string;
  label: string;
  iconName: string;
  iconCodepoint: number;
  url: string;
};
export type SelectionAction = SelectionActionId | CustomSelectionAction;

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

export function validCustomActionUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function parseCustomAction(value: unknown): CustomSelectionAction | null {
  if (!value || typeof value !== "object") return null;
  const action = value as Partial<CustomSelectionAction>;
  if (action.kind !== "custom" || typeof action.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(action.id)) return null;
  if (typeof action.label !== "string" || !action.label.trim() || action.label.length > 48) return null;
  if (typeof action.iconName !== "string" || !/^[a-z0-9-]{1,80}$/.test(action.iconName)) return null;
  if (typeof action.iconCodepoint !== "number" || !Number.isInteger(action.iconCodepoint) || action.iconCodepoint < 0xf0000 || action.iconCodepoint > 0xfffff) return null;
  if (typeof action.url !== "string" || !validCustomActionUrl(action.url)) return null;
  return { kind: "custom", id: action.id, label: action.label.trim(), iconName: action.iconName, iconCodepoint: action.iconCodepoint, url: action.url };
}

export function selectionActionKey(action: SelectionAction): string {
  return typeof action === "string" ? action : `custom:${action.id}`;
}

export function normalizeSelectionActions(
  value: unknown,
  fallback: readonly SelectionAction[],
): SelectionAction[] {
  if (!Array.isArray(value)) return fallback.map((action) => typeof action === "string" ? action : { ...action });
  const result: SelectionAction[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const action = typeof entry === "string" && validActionIds.has(entry)
      ? entry as SelectionActionId
      : parseCustomAction(entry);
    if (!action) continue;
    const key = selectionActionKey(action);
    if (!seen.has(key)) { result.push(action); seen.add(key); }
    if (result.length === 3) break;
  }
  return result;
}

export function selectionActionLabel(action: SelectionAction): string {
  return typeof action === "string"
    ? SELECTION_ACTIONS.find((candidate) => candidate.id === action)?.label ?? action
    : action.label;
}

export function selectionActionUrl(action: SelectionAction, text: string): string | null {
  if (typeof action !== "string") {
    if (!validCustomActionUrl(action.url)) return null;
    const fragment = action.url.indexOf("#");
    return fragment < 0
      ? `${action.url}${encodeURIComponent(text)}`
      : `${action.url.slice(0, fragment)}${encodeURIComponent(text)}${action.url.slice(fragment)}`;
  }
  const id = action;
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
