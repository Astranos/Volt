import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { BookOpen, Check, FileText, KeyRound, ListChecks, StickyNote } from "lucide-react";
import { guideSummary, matchesHandbookQuery, opensAsDocument, pageSummary, type HandbookEntry } from "../../domain/handbook";
import { entryFields, fieldDisplayValue, hasFieldRows } from "../../domain/handbook-format";
import { listHandbook, openHandbookInSidepanel, revealHandbookSecret } from "../../handbook/client";
import { PROFILE_AUTH_EVENT_KEY } from "../../access/chrome-profile-auth";
import { CLERK_CLIENT_JWT_CACHE_KEY } from "../../access/clerk-client-jwt";

const MAX_RESULTS = 6;
export const HANDBOOK_OPEN_ACTION_VALUE = "handbook-open-sidepanel";

// Local storage keys that change whenever the extension's signed-in account does.
const AUTH_KEYS = [CLERK_CLIENT_JWT_CACHE_KEY, PROFILE_AUTH_EVENT_KEY];

/**
 * Loads the handbook each time `enabled` turns on, so every new search sees fresh
 * entries. Entries are dropped as soon as the account changes or signs out, and a
 * response from before that change is ignored. Signed-out or failed loads show nothing.
 */
export function useHandbookCommandEntries(enabled: boolean) {
  const [entries, setEntries] = useState<HandbookEntry[]>([]);
  const [authVersion, setAuthVersion] = useState(0);
  useEffect(() => {
    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== "local" || !AUTH_KEYS.some((key) => key in changes && changes[key].newValue !== changes[key].oldValue)) return;
      setEntries([]);
      setAuthVersion((version) => version + 1);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      return;
    }
    let current = true;
    void listHandbook().then(
      (list) => { if (current) setEntries(list); },
      () => { if (current) setEntries([]); },
    );
    return () => { current = false; };
  }, [enabled, authVersion]);
  return entries;
}

export function handbookCommandMatches(entries: HandbookEntry[], query: string) {
  const trimmed = query.trim();
  return trimmed ? entries.filter((entry) => matchesHandbookQuery(entry, trimmed)).slice(0, MAX_RESULTS) : [];
}

/** Offer the open action alongside handbook results, or when the query names it. */
export function wantsHandbookAction(query: string, matches: HandbookEntry[]) {
  const words = query.trim().toLowerCase();
  return words.length >= 2 && (matches.length > 0 || "open handbook in sidepanel".includes(words));
}

export const handbookCommandValue = (entry: HandbookEntry) => `handbook-${entry._id}`;

// Guides, pages, and quick values with several values open in the sidepanel: there's
// no single thing for Enter to copy.
const opensFromMenu = (entry: HandbookEntry) => opensAsDocument(entry) || (entry.kind === "value" && hasFieldRows(entry));

/**
 * Enter copies a single quick value, copies a login's password through the reveal
 * path, or opens the entry in the sidepanel.
 */
export async function runHandbookCommand(entry: HandbookEntry) {
  if (opensFromMenu(entry)) {
    await openHandbookInSidepanel(entry._id);
    return "opened" as const;
  }
  await navigator.clipboard.writeText(entry.kind === "secret" ? await revealHandbookSecret(entry._id) : fieldDisplayValue(entryFields(entry)[0]));
  return "copied" as const;
}

export function HandbookCommandGroup({
  matches,
  showOpenAction,
  itemClassName,
  onDone,
}: {
  matches: HandbookEntry[];
  showOpenAction: boolean;
  itemClassName: string;
  onDone?: (result: "copied" | "opened") => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  if (!matches.length && !showOpenAction) return null;

  const select = async (entry: HandbookEntry) => {
    try {
      const result = await runHandbookCommand(entry);
      if (result === "copied") {
        setCopiedId(entry._id);
        window.setTimeout(() => setCopiedId((current) => (current === entry._id ? null : current)), 1500);
      }
      onDone?.(result);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <>
      {matches.length ? (
        <Command.Group heading="Handbook" className="cmdk-group">
          {matches.map((entry) => {
            const Icon = entry.kind === "guide" ? ListChecks : entry.kind === "page" ? FileText : entry.kind === "secret" ? KeyRound : StickyNote;
            const detail = entry.kind === "guide" ? guideSummary(entry)
              : entry.kind === "page" ? pageSummary(entry)
                : entry.kind === "secret" ? [entry.username ?? entry.secretPreview, entry.note].filter(Boolean).join(" · ")
                  : [...entryFields(entry).map(fieldDisplayValue), entry.note].filter(Boolean).join(" · ");
            return (
              <Command.Item key={entry._id} value={handbookCommandValue(entry)} onSelect={() => void select(entry)} className={itemClassName}>
                <div className="flex items-center gap-3 px-4 py-3 w-full">
                  <div className="cmdk-handbook-icon rounded p-2">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{entry.title}</p>
                    <p className="text-xs text-gray-500 truncate">{detail}</p>
                  </div>
                  <div className="cmdk-item-kbd-hint cmdk-handbook-hint">
                    {copiedId === entry._id ? (
                      <span className="cmdk-handbook-copied"><Check className="w-3.5 h-3.5" /> Copied</span>
                    ) : (
                      <><kbd className="cmdk-kbd">↵</kbd><span className="text-xs text-gray-500">{opensFromMenu(entry) ? "open" : "copy"}</span></>
                    )}
                  </div>
                </div>
              </Command.Item>
            );
          })}
        </Command.Group>
      ) : null}
      {showOpenAction ? (
        <Command.Group heading="Actions" className="cmdk-group">
          <Command.Item
            value={HANDBOOK_OPEN_ACTION_VALUE}
            onSelect={() => { void openHandbookInSidepanel(); onDone?.("opened"); }}
            className={itemClassName}
          >
            <div className="flex items-center gap-3 px-4 py-3 w-full">
              <div className="cmdk-handbook-icon rounded p-2">
                <BookOpen className="w-4 h-4" />
              </div>
              <p className="flex-1 text-sm font-medium text-gray-900">Open handbook in sidepanel</p>
            </div>
          </Command.Item>
        </Command.Group>
      ) : null}
    </>
  );
}
