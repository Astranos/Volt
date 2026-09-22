import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { ExtensionAccountControl } from "../access/ExtensionAccess";
import { useComputerRegistration } from "../../hooks/useComputerRegistration";
import { computeToolTabIndicator } from "./tool-tab-indicator";

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
  const windowIdRef = useRef<number | null>(null);
  const closeReportedRef = useRef(false);
  const toolTabsRef = useRef<HTMLDivElement | null>(null);
  const toolTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [tabIndicator, setTabIndicator] = useState({ x: 0, width: 0, visible: false });

  // Registered from the panel root rather than from MobileScanner, which
  // unmounts on every tool switch and would let presence lapse while the user
  // is on another tool.
  useComputerRegistration();

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

  useEffect(() => {
    if (typeof chrome === "undefined") return;

    chrome.windows?.getCurrent?.((currentWindow) => {
      if (typeof currentWindow?.id === "number") {
        windowIdRef.current = currentWindow.id;
      }
    });

    const reportClosed = () => {
      if (closeReportedRef.current || !chrome.runtime) return;
      closeReportedRef.current = true;
      chrome.runtime.sendMessage(
        {
          action: "sidePanelDidClose",
          windowId: windowIdRef.current ?? undefined,
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    };

    window.addEventListener("pagehide", reportClosed);
    window.addEventListener("beforeunload", reportClosed);

    return () => {
      window.removeEventListener("pagehide", reportClosed);
      window.removeEventListener("beforeunload", reportClosed);
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

  useLayoutEffect(() => {
    const tablist = toolTabsRef.current;
    if (!tablist || typeof window === "undefined") return;

    const updateIndicator = () => {
      const activeIndex = SIDEPANEL_TOOLS.findIndex((tool) => tool.id === activeTool);
      setTabIndicator(computeToolTabIndicator(
        SIDEPANEL_TOOLS.map((_, index) => {
          const tab = toolTabRefs.current[index];
          return tab
            ? { offsetLeft: tab.offsetLeft, offsetWidth: tab.offsetWidth }
            : { offsetLeft: Number.NaN, offsetWidth: Number.NaN };
        }),
        activeIndex,
      ));
    };

    updateIndicator();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateIndicator) : null;
    observer?.observe(tablist);
    toolTabRefs.current.forEach((tab) => {
      if (tab) observer?.observe(tab);
    });
    window.addEventListener("resize", updateIndicator);
    return () => {
      toolTabRefs.current.forEach((tab) => {
        if (tab) observer?.unobserve(tab);
      });
      observer?.unobserve(tablist);
      observer?.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [activeTool, tools.length]);

  const ActiveComponent =
    tools.find((t) => t.id === activeTool)?.component || MobileScanner;

  const toneStyles = toast ? TOAST_TONE_STYLES[toast.tone] : null;
  const ToastIcon = toneStyles?.icon;

  return (
    <div className="sidepanel-shell sidepanel-frame h-full w-full flex flex-col">
      <div className="sidepanel-content-frame flex flex-1 flex-col overflow-hidden">
        <div className="sidepanel-tool-header">
          <div className="sidepanel-tool-row">
            <div ref={toolTabsRef} className="sidepanel-tool-tabs" role="tablist" aria-label="Volt tools">
              <span
                aria-hidden="true"
                className="sidepanel-tool-tab-indicator"
                style={{
                  transform: `translateX(${tabIndicator.x}px)`,
                  width: `${tabIndicator.width}px`,
                  visibility: tabIndicator.visible ? "visible" : "hidden",
                }}
              />
              {SIDEPANEL_TOOLS.map((tool) => {
                const ToolIcon = tool.icon;
                const selected = activeTool === tool.id;
                return (
                  <button
                    ref={(element) => { toolTabRefs.current[SIDEPANEL_TOOLS.indexOf(tool)] = element; }}
                    key={tool.id}
                    type="button"
                    role="tab"
                    title={tool.label}
                    aria-label={tool.label}
                    aria-selected={selected}
                    className={cn("sidepanel-tool-tab", selected && "is-active")}
                    onClick={() => handleToolChange(tool.id)}
                  >
                    <span className="sidepanel-tool-tab-icon" aria-hidden="true">
                      <ToolIcon />
                    </span>
                    <span className="sidepanel-tool-tab-label" aria-hidden="true">
                      <span>{tool.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <ExtensionAccountControl sharedClerkContext />
          </div>

          {toast && ToastIcon ? (
            <span
              key={toast.id}
              aria-live="polite"
              className={cn("volt-toast-enter sidepanel-tool-toast", toneStyles?.text)}
            >
              <ToastIcon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{toast.message}</span>
            </span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ActiveComponent
            onClose={() => handleToolChange("mobile-scanner")}
          />
        </div>
      </div>
    </div>
  );
}
