import { useEffect, useState } from "react";
import { AppWindow, ExternalLink } from "lucide-react";

export type OpenMode = "popup" | "tab";

/**
 * Shared by the Shopify buttons, right-click menu, highlight pill, and settings.
 * Kept in its own chrome.storage.sync key so writing it can never clobber a
 * concurrent cmdkSettings save.
 */
export const OPEN_MODE_STORAGE_KEY = "openSearchResultsIn";

export const parseOpenMode = (value: unknown): OpenMode => (value === "tab" ? "tab" : "popup");

// Static renders (tests) have no extension APIs.
const extensionStorage = () => (typeof chrome === "undefined" ? undefined : chrome.storage);

/** The stored mode, following changes made anywhere while mounted. */
export function useOpenMode(initial: OpenMode = "popup"): [OpenMode, (mode: OpenMode) => void] {
  const [mode, setMode] = useState(initial);
  useEffect(() => {
    const storage = extensionStorage();
    if (!storage) return;
    let active = true;
    storage.sync.get(OPEN_MODE_STORAGE_KEY).then((stored: Record<string, unknown>) => {
      if (active) setMode(parseOpenMode(stored[OPEN_MODE_STORAGE_KEY]));
    }).catch(() => {});
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "sync" && changes[OPEN_MODE_STORAGE_KEY]) {
        setMode(parseOpenMode(changes[OPEN_MODE_STORAGE_KEY].newValue));
      }
    };
    storage.onChanged.addListener(onChanged);
    return () => {
      active = false;
      storage.onChanged.removeListener(onChanged);
    };
  }, []);
  const choose = (next: OpenMode) => {
    setMode(next);
    try {
      extensionStorage()?.sync.set({ [OPEN_MODE_STORAGE_KEY]: next }).catch(() => {});
    } catch (_) {
      // An extension update invalidates this context; keep the local choice.
    }
  };
  return [mode, choose];
}

type Modifiers = { metaKey?: boolean; ctrlKey?: boolean; button?: number };

/** Modifier and middle clicks follow browser link conventions. */
export function opensInNewTab(mode: OpenMode, modifiers: Modifiers = {}) {
  return mode === "tab" || !!modifiers.metaKey || !!modifiers.ctrlKey || modifiers.button === 1;
}

const OPTIONS = [
  ["popup", "Popup", AppWindow, "Open results in a popup window"],
  ["tab", "New tab", ExternalLink, "Open results in a new tab"],
] as const;

export function OpenModeSwitch({
  mode,
  onChange,
}: {
  mode: OpenMode;
  onChange: (mode: OpenMode) => void;
}) {
  return (
    <div aria-label="Open results in" className="open-mode" role="radiogroup">
      {OPTIONS.map(([value, label, Icon, title]) => (
        <button
          aria-checked={mode === value}
          className="open-mode-option"
          key={value}
          onClick={() => onChange(value)}
          // Keep the page selection while switching.
          onPointerDown={(event) => event.preventDefault()}
          role="radio"
          title={title}
          type="button"
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  );
}

export const openModeStyles = `
      .open-mode{display:flex;flex:none;gap:2px;padding:2px;border-radius:8px;background:#eef2f6;border:1px solid #e2e8f0}
      .open-mode-option{display:flex;align-items:center;gap:5px;height:22px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:#64748b;cursor:pointer;font:600 11px/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;transition:background .12s,color .12s,box-shadow .12s}
      .open-mode-option:hover{color:#0f172a;background:rgba(255,255,255,.6)}
      .open-mode-option[aria-checked="true"]{background:#fff;color:#0f172a;box-shadow:0 0 0 1px #cbd5e1,0 1px 2px rgba(15,23,42,.12)}
      .open-mode-option[aria-checked="true"] svg{color:#16a34a}
      .open-mode-option:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
`;
