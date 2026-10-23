import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { BookOpen, Check, KeyRound, ListChecks, StickyNote } from "lucide-react";
import { guideSummary, matchesHandbookQuery, type HandbookEntry } from "../../domain/handbook";
import { listHandbook, openHandbookInSidepanel, revealHandbookSecret } from "../../handbook/client";

const MAX_RESULTS = 6;
export const HANDBOOK_OPEN_ACTION_VALUE = "handbook-open-sidepanel";

/** Loads the handbook once `enabled` turns on. Signed-out or failed loads show no results. */
export function useHandbookCommandEntries(enabled: boolean) {
  const [entries, setEntries] = useState<HandbookEntry[]>([]);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (!enabled || requested) return;
    setRequested(true);
    void listHandbook().then(setEntries, () => setEntries([]));
  }, [enabled, requested]);
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

/**
 * Enter copies a quick value, copies a login through the reveal path, or opens
 * a guide in the sidepanel.
 */
export async function runHandbookCommand(entry: HandbookEntry) {
  if (entry.kind === "guide") {
    await openHandbookInSidepanel(entry._id);
    return "opened" as const;
  }
  await navigator.clipboard.writeText(entry.kind === "secret" ? await revealHandbookSecret(entry._id) : entry.value ?? "");
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
            const Icon = entry.kind === "guide" ? ListChecks : entry.kind === "secret" ? KeyRound : StickyNote;
            const detail = entry.kind === "guide" ? guideSummary(entry)
              : entry.kind === "secret" ? `${entry.secretPreview ?? ""}${entry.note ? ` · ${entry.note}` : ""}`
                : [entry.value, entry.note].filter(Boolean).join(" · ");
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
                      <><kbd className="cmdk-kbd">↵</kbd><span className="text-xs text-gray-500">{entry.kind === "guide" ? "open" : "copy"}</span></>
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
