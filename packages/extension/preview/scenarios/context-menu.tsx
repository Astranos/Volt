import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Calculator, ChevronLeft, ChevronRight, Clipboard, Copy, Download, ExternalLink, Link2, PackageSearch, Search, Settings, Smartphone, Sparkles, TrendingUp } from "lucide-react";
import { ContextMenu, type MenuAction } from "@/src/components/context-menu";
import { styles } from "@/src/components/context-menu-styles";
import { DEFAULT_CONTEXT_ACTIONS, selectionActionLabel, type SelectionActionId } from "@/src/domain/selection-actions";
import { defineScenario } from "../scenario";

// Mirrors the actions entrypoints/context-menu.tsx builds; only looks matter here.
const noop = () => {};
const icons: Record<SelectionActionId, MenuAction["icon"]> = {
  ebay: PackageSearch, "google-upc": Search, pricecharting: TrendingUp, "google-search": Search,
  "copy-highlight-link": Link2, "look-up": BookOpen, "ask-gemini": Sparkles,
};
const selectionActions: MenuAction[] = DEFAULT_CONTEXT_ACTIONS.map((id) => ({
  id, label: selectionActionLabel(id), icon: icons[id], requiresSelection: true, opensUrl: true, onInvoke: noop,
}));
const toolActions: MenuAction[] = [
  { id: "mobile-scanner", label: "Mobile Scanner", shortcut: "V", description: "Open mobile scanner", icon: Smartphone, onInvoke: noop },
  { id: "offer-calculator", label: "Offer Calculator", shortcut: "O", description: "Open offer calculator in the sidepanel", icon: Calculator, onInvoke: noop },
  { id: "settings", label: "Settings", shortcut: "S", description: "Open extension settings", icon: Settings, onInvoke: noop },
];
const quickActions: MenuAction[] = [
  { id: "copy", label: "Copy", icon: Copy, requiresSelection: true, onInvoke: noop },
  { id: "paste", label: "Paste", icon: Clipboard, onInvoke: noop },
  { id: "go-left", label: "Go to Previous Tab", icon: ChevronLeft, onInvoke: noop },
  { id: "go-right", label: "Go to Next Tab", icon: ChevronRight, onInvoke: noop },
  { id: "open-in-new-tab", label: "Open in New Tab", icon: ExternalLink, requiresUrl: true, onInvoke: noop },
  { id: "save-as", label: "Save As...", icon: Download, requiresUrl: true, onInvoke: noop },
];

/** The menu lives in a shadow root on real pages, isolated from page styles. */
function Shadow({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  useLayoutEffect(() => setRoot(host.current!.shadowRoot ?? host.current!.attachShadow({ mode: "open" })), []);
  return <div ref={host}>{root && createPortal(<><style>{styles()}</style><div className="volt-cm-root">{children}</div></>, root)}</div>;
}

// ?selection=<text> (default "0045496882648"; empty for no selection), ?link=1 for a right-clicked link.
export default defineScenario({
  description: "Right-click menu over a sample page (?selection=, ?link=1)",
  viewport: { width: 560, height: 640 },
  render: (params) => {
    const selection = params.get("selection") ?? "0045496882648";
    return (
      <>
        <article style={{ font: "15px/1.6 Georgia, serif", color: "#334155", padding: "32px 40px", maxWidth: 520 }}>
          <h1 style={{ font: "700 22px/1.3 system-ui", color: "#0f172a" }}>Nintendo Switch OLED Model</h1>
          <p>UPC <mark style={{ background: selection ? "#bfdbfe" : "transparent" }}>0045496882648</mark> · White Joy-Con · 64GB</p>
          <p>The OLED model features a vibrant 7-inch screen, a wide adjustable stand, a dock with a wired LAN port, and enhanced audio.</p>
        </article>
        <Shadow>
          <ContextMenu
            actions={[...selectionActions, ...toolActions]}
            selectionActionCount={selectionActions.length}
            quickActions={quickActions}
            lastSelection={selection}
            clickedUrl={params.get("link") ? "https://www.example.com/listing/123" : null}
            x={180}
            y={92}
            closeMenu={noop}
            openMode="popup"
            dismiss={noop}
          />
        </Shadow>
      </>
    );
  },
});
