import { HANDBOOK_OPEN_ENTRY_KEY, type HandbookEntry, type HandbookEntryId } from "../domain/handbook";

async function send(action: string, extra: Record<string, unknown> = {}): Promise<unknown> {
  const response: unknown = await chrome.runtime.sendMessage({ action, ...extra });
  if (!response || typeof response !== "object") throw new Error("Handbook did not respond.");
  const result = response as { success?: unknown; value?: unknown; error?: unknown };
  if (result.success !== true) throw new Error(typeof result.error === "string" ? result.error : "Handbook request failed.");
  return result.value;
}

/** The signed-in account's handbook, with secret entries masked by the server. */
export async function listHandbook(): Promise<HandbookEntry[]> {
  const value = await send("handbookList");
  if (!Array.isArray(value)) throw new Error("Handbook returned an invalid list.");
  return value as HandbookEntry[];
}

export async function revealHandbookSecret(id: HandbookEntryId): Promise<string> {
  const value = await send("handbookRevealSecret", { id });
  const secret = value && typeof value === "object" ? (value as { secret?: unknown }).secret : undefined;
  if (typeof secret !== "string") throw new Error("Handbook returned an invalid login.");
  return secret;
}

export function openHandbookInSidepanel(entryId?: HandbookEntryId) {
  // Written before the open request, without awaiting, so the user gesture
  // still reaches sidePanel.open. The panel picks it up on mount or on change.
  if (entryId) void chrome.storage.local.set({ [HANDBOOK_OPEN_ENTRY_KEY]: { id: entryId, requestedAt: Date.now() } });
  return chrome.runtime.sendMessage({ action: "openInSidebar", tool: "handbook", mode: "open" });
}
