import React, { useState, useEffect, useRef } from "react";
import ControllerTesting from "./ControllerTesting";
import TopOffersPage from "./TopOffers";
import EbayTaxonomyTool from "./EbayTaxonomyTool";
import BuyingGuide from "./BuyingGuide";
import ShopifyHelp from "./ShopifyHelp";
import MobileScanner from "./MobileScanner";
import MobilePhotos from "./MobilePhotos";
import { ChevronDown } from "lucide-react";
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

export default function UnifiedSidepanel() {
  const [activeTool, setActiveTool] =
    useState<SidepanelToolId>("controller-testing");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [dropdownWidth, setDropdownWidth] = useState<number>();

  // Load the initial tool from storage
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(
        { sidePanelTool: "controller-testing" },
        (result: { sidePanelTool?: string }) => {
          const storedTool = result.sidePanelTool;
          const tool = storedTool && isSidepanelToolId(storedTool)
            ? storedTool
            : "controller-testing";
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
            : "controller-testing";
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
    "controller-testing": ControllerTesting,
    "top-offers": TopOffersPage,
    "ebay-taxonomy-tool": EbayTaxonomyTool,
    "buying-guide": BuyingGuide,
    "shopify-help": ShopifyHelp,
    "mobile-scanner": MobileScanner,
    "mobile-photos": MobilePhotos,
  };

  const tools = SIDEPANEL_TOOLS.map((tool) => ({
    ...tool,
    component: componentMap[tool.id],
  }));

  const ActiveComponent =
    tools.find((t) => t.id === activeTool)?.component || ControllerTesting;

  const activeToolMeta = tools.find((t) => t.id === activeTool) || tools[0];

  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Fixed Header */}
      <div className="flex-none p-2 pb-2 bg-background z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg border border-input bg-card px-4 py-2 text-left text-lg font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-primary/40 hover:bg-accent/40"
              ref={triggerRef}
            >
              <span className="flex items-center gap-2">
                <activeToolMeta.icon className="h-5 w-5" />
                {activeToolMeta.label}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={8}
            className="p-1"
            style={{
              width: dropdownWidth ? `${dropdownWidth}px` : undefined,
            }}
          >
            {tools.map((tool) => (
              <DropdownMenuItem
                key={tool.id}
                onSelect={() => handleToolChange(tool.id)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  activeTool === tool.id
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground"
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
          onClose={() => handleToolChange("controller-testing")}
        />
      </div>
    </div>
  );
}
