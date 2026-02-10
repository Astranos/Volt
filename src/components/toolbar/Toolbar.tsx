import * as React from "react";
import {
  SIDEPANEL_TOOLS,
  type SidepanelToolId,
} from "../../lib/sidepanel-tools";
import {
  triggerSidepanelToolFromContentScript,
  isSidePanelApiAvailable,
} from "../../lib/sidepanel-gesture";

type ToolbarTool = {
  id: SidepanelToolId;
  label: string;
  description: string;
  buttonId: string;
  reactIcon: React.ComponentType<{ size?: number; className?: string }>;
};

const buttonIdMap: Record<SidepanelToolId, string> = {
  "controller-testing": "scout-tb-controller",
  "top-offers": "scout-tb-top-offers",
  "pc-cost-breakdown": "scout-tb-pc-costs",
  "ebay-taxonomy-tool": "scout-tb-ebay-taxonomy",
  "buying-guide": "scout-tb-buying-guide",
  "shopify-help": "scout-tb-shopify-help",
  "price-charting-tool": "scout-tb-price-charting",
  "tabs-manager": "scout-tb-tabs-manager",
};

const TOOLBAR_TOOLS: ToolbarTool[] = SIDEPANEL_TOOLS.map((tool) => ({
  id: tool.id,
  label: tool.label,
  description: tool.description,
  buttonId: buttonIdMap[tool.id],
  reactIcon: tool.icon,
}));

function getIconElement(tool: ToolbarTool) {
  try {
    if (tool.reactIcon) {
      const Icon = tool.reactIcon;
      return <Icon size={20} className="scout-tb-icon" />;
    }
  } catch {
    // noop – icon rendering failure shouldn't break the toolbar
  }
  return null;
}

export default function Toolbar() {
  const [dismissed, setDismissed] = React.useState(false);

  const openWithFallback = (toolId: SidepanelToolId) => {
    try {
      chrome.runtime.sendMessage({
        action: "openInSidebar",
        tool: toolId,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[Scout Toolbar] Fallback sidepanel open failed:", error);
    }
  };

  const handleToolClick = (toolId: SidepanelToolId) => {
    if (!isSidePanelApiAvailable()) {
      openWithFallback(toolId);
      return;
    }
    try {
      triggerSidepanelToolFromContentScript(toolId, {
        source: "toolbar",
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[Scout Toolbar] Sidepanel trigger error:", err);
        openWithFallback(toolId);
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[Scout Toolbar] Failed to open sidepanel tool:", e);
      openWithFallback(toolId);
    }
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem("scout-toolbar-closed", "true");
    } catch {
      // ignore storage failures
    }
    setDismissed(true);
  };

  React.useEffect(() => {
    try {
      const wasClosed = localStorage.getItem("scout-toolbar-closed") === "true";
      if (wasClosed) {
        setDismissed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    if (dismissed) return;

    const toolbar = document.getElementById("scout-toolbar");
    if (!toolbar) return;

    let mouseTimeout: number | undefined;
    let initialTimeout: number | undefined;
    let initialHideTimeout: number | undefined;
    let isVisible = false;

    const showToolbar = () => {
      if (isVisible) return;
      isVisible = true;
      toolbar.classList.remove("scout-hidden");
      toolbar.classList.add("scout-visible");
      toolbar.setAttribute("aria-hidden", "false");
    };

    const hideToolbar = () => {
      if (!isVisible) return;
      isVisible = false;
      toolbar.classList.remove("scout-visible");
      toolbar.classList.add("scout-hidden");
      toolbar.setAttribute("aria-hidden", "true");
    };

    const handleMouseMove = () => {
      showToolbar();
      if (mouseTimeout) window.clearTimeout(mouseTimeout);
      mouseTimeout = window.setTimeout(hideToolbar, 1000);
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });

    // Initial peek: hide → brief show → hide again
    hideToolbar();
    initialTimeout = window.setTimeout(() => {
      showToolbar();
      initialHideTimeout = window.setTimeout(hideToolbar, 2000);
    }, 800);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      if (mouseTimeout) window.clearTimeout(mouseTimeout);
      if (initialTimeout) window.clearTimeout(initialTimeout);
      if (initialHideTimeout) window.clearTimeout(initialHideTimeout);
    };
  }, [dismissed]);

  if (dismissed) return null;

  return (
    <div id="scout-toolbar" aria-hidden="true" className="scout-hidden">
      <style
        // Inline CSS keeps the toolbar self-contained and avoids touching host page styles.
        dangerouslySetInnerHTML={{
          __html: `
/* Scout Floating Toolbar CSS */
#scout-toolbar {
  position: fixed;
  right: 9px;
  top: 50%;
  transform: translate(120%, -50%);
  z-index: 2147483646;
  opacity: 0;
  visibility: hidden;
}
#scout-toolbar.scout-visible {
  opacity: 1;
  visibility: visible;
  transform: translate(0, -50%);
  transition: 
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.3s ease-out,
    visibility 0s linear 0s;
}
#scout-toolbar.scout-hidden {
  opacity: 0;
  visibility: hidden;
  transform: translate(120%, -50%);
  transition: 
    transform 0.3s cubic-bezier(0.5, 0, 0.75, 0),
    opacity 0.2s ease-in,
    visibility 0s linear 0.3s;
}

.scout-toolbar-wrapper {
  position: relative;
  overflow: visible;
}
.scout-dismiss-container {
  position: absolute;
  top: -42px;
  left: 50%;
  transform: translateX(-50%);
  width: 42px;
  height: 42px;
  overflow: hidden;
  z-index: 5;
}
.scout-dismiss-btn {
  position: absolute;
  top: 42px;
  left: 50%;
  transform: translateX(-50%);
  transition: top 0.3s ease;
}
.scout-toolbar-wrapper:hover .scout-dismiss-btn {
  top: 0;
}

/* Color variables (stone theme) */
#scout-toolbar {
  --scout-bg: #292524;
  --scout-surface: #44403c;
  --scout-border: #57534e;
  --scout-border-soft: #78716c;
  --scout-foreground: #f5f5f4;
  --scout-foreground-strong: #fafaf9;
  --scout-hover: #57534e;
  --scout-badge: #a8a29e;
}

.scout-tb {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  background: var(--scout-bg);
  border: 1px solid var(--scout-border-soft);
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  user-select: none;
  position: relative;
  z-index: 10;
}
.scout-tb-close {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--scout-surface);
  border: 1px solid var(--scout-border);
  color: var(--scout-foreground);
  cursor: pointer;
  position: relative;
  margin-bottom: 2px;
  transition: all 0.2s ease;
}
.scout-tb-divider {
  width: 100%;
  height: 1px;
  background: var(--scout-border-soft);
  margin: 0 0 2px 0;
  border-radius: 0.5px;
}
.scout-tb-item {
  position: relative;
}
.scout-tb-btn {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--scout-surface);
  border: 1px solid var(--scout-border);
  color: var(--scout-foreground);
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
}
.scout-tip {
  position: absolute;
  right: 110%;
  top: 50%;
  transform: translateY(-50%);
  background: var(--scout-bg);
  border: 1px solid var(--scout-border-soft);
  color: var(--scout-foreground-strong);
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 12px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.scout-tb-item:hover .scout-tip {
  opacity: 1;
  transform: translateY(-50%) translateX(-2px);
}
.scout-tb-icon {
  width: 22px;
  height: 22px;
  display: block;
  object-fit: contain;
  object-position: center;
  margin: 0 auto;
}
.scout-tb-close:hover,
.scout-tb-btn:hover {
  background: var(--scout-hover);
  border-color: var(--scout-border);
}
.scout-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  background: var(--scout-badge);
  color: #fff;
  border-radius: 9999px;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  border: 1px solid rgba(0, 0, 0, 0.3);
  display: none;
}
        `,
        }}
      />

      <div className="scout-toolbar-wrapper">
        <div className="scout-tb" role="toolbar">
          <div className="scout-dismiss-container">
            <div className="scout-dismiss-btn">
              <button
                className="scout-tb-close"
                id="scout-tb-close"
                aria-label="Dismiss Toolbar"
                onClick={handleDismiss}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
              <div className="scout-tip">Dismiss</div>
            </div>
          </div>

          {TOOLBAR_TOOLS.map((tool) => (
            <div className="scout-tb-item" key={tool.id}>
              <button
                className="scout-tb-btn"
                id={tool.buttonId}
                aria-label={tool.label}
                onClick={() => handleToolClick(tool.id)}
              >
                {getIconElement(tool)}
              </button>
              <div className="scout-tip">{tool.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
