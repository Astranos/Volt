import React, { useState, useEffect, useRef } from "react";
import TopOffersPage from "./TopOffers";
import ShopifyHelp from "./ShopifyHelp";
import MobileScanner from "./MobileScanner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  XCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [dropdownWidth, setDropdownWidth] = useState<number>();
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

  // Send ready message to background
  useEffect(() => {
    try {
      // Only send if runtime is available
      if (chrome?.runtime?.id) {
        // We don't strictly need to notify background on every render,
        // but if we do, use a known action or ignore the error.
        // For now, we can remove this message if it's not handled.
        /*
        chrome.runtime.sendMessage({
          action: "sidepanelReady",
          tool: activeTool,
          timestamp: Date.now(),
        });
        */
      }
    } catch (e) {
      console.error("Error sending sidepanel ready message:", e);
    }
  }, [activeTool]);

  useEffect(() => {
    const updateWidth = () => {
      if (triggerRef.current) {
        setDropdownWidth(triggerRef.current.getBoundingClientRect().width);
      }
    };

    updateWidth();

    if (typeof ResizeObserver !== "undefined" && triggerRef.current) {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(triggerRef.current);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateWidth);
    return () => {
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  const componentMap: Record<
    SidepanelToolId,
    React.ComponentType<{ onClose?: () => void }>
  > = {
    "top-offers": TopOffersPage,
    "shopify-help": ShopifyHelp,
    "mobile-scanner": MobileScanner,
    "mobile-photos": MobileScanner,
  };

  const tools = SIDEPANEL_TOOLS.map((tool) => ({
    ...tool,
    component: componentMap[tool.id],
  }));

  const ActiveComponent =
    tools.find((t) => t.id === activeTool)?.component || MobileScanner;

  const activeToolMeta = tools.find((t) => t.id === activeTool) || tools[0];

  const toneStyles = toast ? TOAST_TONE_STYLES[toast.tone] : null;
  const ToastIcon = toneStyles?.icon;

  return (
    <div className="sidepanel-shell h-full w-full flex flex-col">
      {/* Fixed Header */}
      <div className="flex-none p-2 pb-2 z-10">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="liquid-glass concentric-lg relative flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden px-3 py-1.5 text-left text-sm font-semibold text-stone-950 transition focus:outline-none focus:ring-2 focus:ring-primary/40 hover:bg-white/60 dark:text-stone-50 dark:hover:bg-white/5"
              ref={triggerRef}
            >
              <span className="relative flex min-w-0 flex-1 items-center">
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-2 transition-all duration-200 ease-out",
                    toast
                      ? "-translate-y-1 opacity-0"
                      : "translate-y-0 opacity-100",
                  )}
                  aria-hidden={toast ? "true" : undefined}
                >
                  <activeToolMeta.icon className="h-4 w-4 shrink-0" />
                  <span className="whitespace-normal break-words leading-tight">{activeToolMeta.label}</span>
                </span>
                {toast && ToastIcon ? (
                  <span
                    key={toast.id}
                    aria-live="polite"
                    className={cn(
                      "volt-toast-enter absolute inset-y-0 left-0 flex min-w-0 items-center gap-2 text-sm font-bold",
                      toneStyles?.text,
                    )}
                  >
                    <ToastIcon className="h-4 w-4 shrink-0" />
                    <span className="whitespace-normal break-words leading-tight">{toast.message}</span>
                  </span>
                ) : null}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                  toast && "scale-90 opacity-60",
                )}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={2}
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="sidepanel-tool-menu liquid-glass concentric-lg p-1"
            style={{
              width: dropdownWidth ? `${dropdownWidth}px` : undefined,
            }}
          >
            {tools.map((tool) => (
              <DropdownMenuItem
                key={tool.id}
                onSelect={() => {
                  handleToolChange(tool.id);
                  setMenuOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 concentric-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                  activeTool === tool.id
                    ? "bg-primary text-primary-foreground"
                    : "text-stone-800 hover:bg-green-100/85 hover:text-stone-950 focus:bg-green-100/85 focus:text-stone-950 data-[highlighted]:bg-green-100/85 data-[highlighted]:text-stone-950 dark:text-stone-100 dark:hover:bg-white/10 dark:hover:text-stone-50 dark:focus:bg-white/10 dark:focus:text-stone-50 dark:data-[highlighted]:bg-white/10 dark:data-[highlighted]:text-stone-50"
                )}
              >
                <tool.icon className="h-4 w-4" />
                <span>{tool.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
