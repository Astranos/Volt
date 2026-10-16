import { AppWindow, ExternalLink } from "lucide-react";

export type OpenMode = "popup" | "tab";

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
      .open-mode{display:flex;flex:none;padding:2px;border-radius:8px;background:#f1f5f9;border:1px solid #e2e8f0}
      .open-mode-option{display:flex;align-items:center;gap:4px;height:22px;padding:0 7px;border:0;border-radius:6px;background:transparent;color:#64748b;cursor:pointer;font:600 11px/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;transition:background .12s,color .12s}
      .open-mode-option:hover{color:#0f172a}
      .open-mode-option[aria-checked="true"]{background:#fff;color:#0f172a;box-shadow:0 1px 2px rgba(15,23,42,.12)}
      .open-mode-option:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
`;
