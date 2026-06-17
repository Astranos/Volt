import React, { useState, useEffect, useRef } from "react";
import TopOffersPage from "./TopOffers";
import MobileScanner from "./MobileScanner";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  SIDEPANEL_TOOLS,
  isSidepanelToolId,
  type SidepanelToolId,
} from "../../lib/sidepanel-tools";
import {
  SIDEPANEL_TOAST_EVENT,
  type SidepanelToastDetail,
  type SidepanelToastTone,
} from "../../lib/sidepanel-toast";

type ActiveToast = {
  message: string;
  tone: SidepanelToastTone;
  id: number;
};

const TOAST_DURATION_MS = 1900;

const TOAST_TONE_STYLES: Record<
  SidepanelToastTone,
  { text: string; icon: React.ComponentType<{ className?: string }> }
> = {
  success: {
    text: "text-green-700 dark:text-green-300",
    icon: CheckCircle2,
  },
  info: {
    text: "text-sky-700 dark:text-sky-300",
    icon: Info,
  },
  warning: {
    text: "text-amber-700 dark:text-amber-300",
    icon: AlertTriangle,
  },
  error: {
    text: "text-red-600 dark:text-red-300",
    icon: XCircle,
  },
};

export default function UnifiedSidepanel() {
  const [activeTool, setActiveTool] =
    useState<SidepanelToolId>("mobile-scanner");
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const toastCounter = useRef(0);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SidepanelToastDetail>).detail;
      if (!detail || typeof detail.message !== "string" || !detail.message) {
        return;
      }
      toastCounter.current += 1;
      const id = toastCounter.current;
      const tone: SidepanelToastTone = detail.tone ?? "success";
      setToast({ message: detail.message, tone, id });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => {
        setToast((curr) => (curr && curr.id === id ? null : curr));
        toastTimer.current = null;
      }, TOAST_DURATION_MS);
    };
    window.addEventListener(SIDEPANEL_TOAST_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(
        SIDEPANEL_TOAST_EVENT,
        handler as EventListener,
      );
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // Load the initial tool from storage
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(
        { sidePanelTool: "mobile-scanner" },
        (result: { sidePanelTool?: string }) => {
          const storedTool = result.sidePanelTool;
          const tool = storedTool && isSidepanelToolId(storedTool)
            ? storedTool
            : "mobile-scanner";
          setActiveTool(tool);
        }
      );

      // Listen for storage changes to switch tools dynamically
      const handleStorageChange = (changes: any, areaName: string) => {
        if (areaName === "local" && changes.sidePanelTool) {
          const storedTool = changes.sidePanelTool.newValue;
          const newTool = typeof storedTool === "string" &&
            isSidepanelToolId(storedTool)
            ? storedTool
            : "mobile-scanner";
          setActiveTool(newTool);
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);

      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, []);

  // Update storage when tool changes
  const handleToolChange = (value: SidepanelToolId) => {
    setActiveTool(value);
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ sidePanelTool: value });
    }
  };

  const componentMap: Record<
    SidepanelToolId,
    React.ComponentType<{ onClose?: () => void }>
  > = {
    "top-offers": TopOffersPage,
    "mobile-scanner": MobileScanner,
    "mobile-photos": MobileScanner,
  };

  const tools = SIDEPANEL_TOOLS.map((tool) => ({
    ...tool,
    component: componentMap[tool.id],
  }));

  const ActiveComponent =
    tools.find((t) => t.id === activeTool)?.component || MobileScanner;
  const activeToolIndex = Math.max(
    0,
    tools.findIndex((tool) => tool.id === activeTool),
  );

  const toneStyles = toast ? TOAST_TONE_STYLES[toast.tone] : null;
  const ToastIcon = toneStyles?.icon;

  return (
    <div className="sidepanel-shell h-full w-full flex flex-col">
      {/* Fixed Header */}
      <div className="sidepanel-tool-switch-wrap">
        <div className="sidepanel-tool-switch">
          <div
            role="radiogroup"
            aria-label="Sidepanel tool"
            className={cn(
              "sidepanel-tool-options",
              toast ? "-translate-y-1 opacity-0" : "translate-y-0 opacity-100",
            )}
            aria-hidden={toast ? "true" : undefined}
          >
            <span
              className="sidepanel-tool-indicator"
              style={{
                width: `calc((100% - ${(tools.length - 1) * 0.25}rem) / ${tools.length})`,
                transform: `translateX(calc(${activeToolIndex} * (100% + 0.25rem)))`,
              }}
            />
            {tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                role="radio"
                aria-checked={activeTool === tool.id}
                aria-label={tool.label}
                onClick={() => handleToolChange(tool.id)}
                className={cn(
                  "sidepanel-tool-option",
                  activeTool === tool.id && "is-active",
                )}
              >
                <tool.icon
                  className="sidepanel-tool-option-icon"
                />
                <span className="sidepanel-tool-option-label">
                  {tool.id === "top-offers" ? "Offer Calculator" : "Scanner"}
                </span>
              </button>
            ))}
          </div>
          <span className="pointer-events-none absolute inset-1.5 flex min-w-0 items-center px-3">
            {toast && ToastIcon ? (
              <span
                key={toast.id}
                aria-live="polite"
                className={cn(
                  "volt-toast-enter flex min-w-0 items-center gap-3 text-base font-bold",
                  toneStyles?.text,
                )}
              >
                <ToastIcon className="h-5 w-5 shrink-0" />
                <span className="whitespace-normal break-words leading-tight">{toast.message}</span>
              </span>
            ) : null}
          </span>
        </div>
      </div>

      {/* Main content - Flex 1 to take remaining space, overflow hidden to prevent double scrollbars */}
      <div className="flex-1 overflow-hidden">
        <ActiveComponent
          onClose={() => handleToolChange("mobile-scanner")}
        />
      </div>
    </div>
  );
}
