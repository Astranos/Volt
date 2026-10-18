import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SelectionSuggestionPill } from "@/src/components/selection-suggestion-pill";
import { selectionStyles } from "@/src/components/context-menu-styles";
import { UPC_HOVER_ACTIONS, selectionActionLabel } from "@/src/domain/selection-actions";
import { positionSelectionSuggestions, selectionSuggestionActionWidth, selectionSuggestionPillWidth } from "@/src/domain/selection-suggestions";
import { defineScenario } from "../scenario";

const UPC = "045496882648";

// Mirrors the styles entrypoints/upc-highlighter.ts injects into the page.
const highlightCss = `
  .volt-upc-highlight{background-color:rgba(59,130,246,.25);border-bottom:2px solid #3b82f6;cursor:pointer;padding:1px 2px;border-radius:2px}
  .volt-upc-copied{background-color:rgba(16,185,129,.2)!important;border-bottom-color:#10b981!important}
  .volt-upc-tooltip{position:fixed;background-color:#1f2937;color:white;padding:4px 8px;border-radius:4px;font:12px system-ui;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3)}
`;

/** The pill lives in a shadow root on real pages, isolated from page styles. */
function Shadow({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  useLayoutEffect(() => setRoot(host.current!.shadowRoot ?? host.current!.attachShadow({ mode: "open" })), []);
  return <div ref={host}>{root && createPortal(<><style>{selectionStyles()}</style>{children}</>, root)}</div>;
}

function UpcPage({ copied }: { copied: boolean }) {
  const upc = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => setRect(upc.current!.getBoundingClientRect()), []);
  const actionWidths = UPC_HOVER_ACTIONS.map((action) => selectionSuggestionActionWidth(selectionActionLabel(action).length * 7));
  return (
    <>
      <style>{highlightCss}</style>
      <article style={{ font: "15px/1.6 Georgia, serif", color: "#334155", padding: "120px 40px 32px", maxWidth: 520 }}>
        <h1 style={{ font: "700 22px/1.3 system-ui", color: "#0f172a" }}>Nintendo Switch OLED Model</h1>
        <p>UPC <span ref={upc} className={copied ? "volt-upc-highlight volt-upc-copied" : "volt-upc-highlight"} data-upc={UPC}>{UPC}</span> · White Joy-Con · 64GB</p>
        <p>The OLED model features a vibrant 7-inch screen, a wide adjustable stand, a dock with a wired LAN port, and enhanced audio.</p>
      </article>
      {rect && copied && (
        <div className="volt-upc-tooltip" style={{ left: rect.left + rect.width / 2 - 45, top: rect.top - 34 }}>UPC copied!</div>
      )}
      {rect && !copied && (
        <Shadow>
          <SelectionSuggestionPill
            actions={UPC_HOVER_ACTIONS}
            actionWidths={actionWidths}
            copyLabel="Copy UPC"
            onCopy={() => {}}
            onAction={() => {}}
            openMode="popup"
            position={positionSelectionSuggestions({
              pillWidth: selectionSuggestionPillWidth(actionWidths),
              rect,
              viewportHeight: window.innerHeight,
              viewportWidth: window.innerWidth,
            })}
          />
        </Shadow>
      )}
    </>
  );
}

// ?state=copied shows the click-to-copy feedback instead of the hover menu.
export default defineScenario({
  description: "Hover menu on a highlighted UPC (?state=copied for click-to-copy)",
  viewport: { width: 560, height: 360 },
  render: (params) => <UpcPage copied={params.get("state") === "copied"} />,
});
