import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/button";
import {
  HelpCircle,
  ChevronRight,
  ChevronLeft,
  X,
  Search,
  History,
  TrendingUp,
  Barcode,
  Tag,
  Store,
} from "lucide-react";
import { cn } from "../../lib/utils";

export type SearchMode =
  | "google"
  | "ebay"
  | "pricecharting"
  | "barcodelookup"
  | "shopify";

interface TourStep {
  targetId: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  position: "bottom" | "top" | "left" | "right";
  mode?: SearchMode;
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "tour-search-history",
    title: "Unified Search & History",
    description:
      "Search with the selected provider, or use prefixes like e iphone 15, p pokemon blue, u 012345678905, g iphone 15, and s iphone 15. Recently closed tabs are also available here.",
    icon: <Search className="h-5 w-5 text-green-600" />,
    position: "right",
  },
  {
    targetId: "tour-search-google",
    title: "Google Search",
    description:
      "Use Google for general searches and direct URLs. You can also type g followed by your query.",
    icon: <Search className="h-5 w-5 text-green-600" />,
    position: "bottom",
    mode: "google",
  },
  {
    targetId: "tour-search-pricecharting",
    title: "PriceCharting Search",
    description:
      "Use PriceCharting for quick game and card price lookups. You can also type p followed by your query.",
    icon: <TrendingUp className="h-5 w-5 text-green-600" />,
    position: "bottom",
    mode: "pricecharting",
  },
  {
    targetId: "tour-search-upc",
    title: "UPC Lookup",
    description:
      "Use UPC for barcode and product lookups. You can also type u followed by the barcode or query.",
    icon: <Barcode className="h-5 w-5 text-green-600" />,
    position: "bottom",
    mode: "barcodelookup",
  },
  {
    targetId: "tour-search-ebay",
    title: "eBay Sold Prices",
    description:
      "Use eBay to check sold prices. You can also type e followed by your query, like e iphone 15.",
    icon: <Tag className="h-5 w-5 text-green-600" />,
    position: "bottom",
    mode: "ebay",
  },
  {
    targetId: "tour-search-shopify",
    title: "Shopify Inventory",
    description:
      "Use Shopify to search available inventory. You can also type s followed by your query.",
    icon: <Store className="h-5 w-5 text-green-600" />,
    position: "bottom",
    mode: "shopify",
  },
  {
    targetId: "tour-recent-tabs",
    title: "Recently Closed Tabs",
    description:
      "The first card section shows tabs you recently closed. You can also press Ctrl+Shift+Z anywhere in Chrome to reopen the last closed tab.",
    icon: <History className="h-5 w-5 text-green-600" />,
    position: "right",
  },
  {
    targetId: "tour-earlier-today",
    title: "Earlier Today",
    description:
      "Older recently closed tabs stay in this list, so the newest few cards stay easy to scan while the rest are still close by.",
    icon: <History className="h-5 w-5 text-green-600" />,
    position: "right",
  },
];

interface NewTabHelpProps {
  onSelectMode?: (mode: SearchMode) => void;
}

export function NewTabHelp({ onSelectMode }: NewTabHelpProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  const updateCoords = useCallback(() => {
    const step = TOUR_STEPS[currentStep];
    const el = document.getElementById(step.targetId);
    if (!el) {
      if (currentStep < TOUR_STEPS.length - 1) {
        setCurrentStep((s) => s + 1);
      } else {
        setIsOpen(false);
        setCurrentStep(0);
      }
      return;
    }

    const rect = el.getBoundingClientRect();
    setCoords({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });

    // If step has a mode, select it
    if (step.mode && onSelectMode) {
      onSelectMode(step.mode);
    }
  }, [currentStep, onSelectMode]);

  useEffect(() => {
    if (isOpen) {
      updateCoords();
      window.addEventListener("resize", updateCoords);
      return () => window.removeEventListener("resize", updateCoords);
    }
  }, [isOpen, updateCoords]);

  const nextStep = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      setIsOpen(false);
      setCurrentStep(0);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  };

  const step = TOUR_STEPS[currentStep];

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 ml-2 text-gray-400 hover:text-green-600 transition-colors gap-1.5"
        onClick={() => {
          setIsOpen(true);
          setCurrentStep(0);
        }}
        title="Start Page Tour"
      >
        <HelpCircle className="h-4 w-4" />
        <span className="text-sm font-medium">View Guide</span>
      </Button>

      {isOpen &&
        coords &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
            {/* SVG Overlay with Hole */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <defs>
                <mask id="tour-mask">
                  <rect x="0" y="0" width="100%" height="100%" fill="white" />
                  <rect
                    x={coords.left - 8}
                    y={coords.top - 8}
                    width={coords.width + 16}
                    height={coords.height + 16}
                    rx="12"
                    fill="black"
                    className="transition-all duration-300 ease-in-out"
                  />
                </mask>
              </defs>
              <rect
                x="0"
                y="0"
                width="100%"
                height="100%"
                fill="rgba(0,0,0,0.7)"
                mask="url(#tour-mask)"
                className="pointer-events-auto"
                onClick={() => setIsOpen(false)}
              />
            </svg>

            {/* Tooltip Content */}
            <div
              className={cn(
                "absolute z-[101] w-80 bg-white rounded-xl shadow-2xl p-6 transition-all duration-300 ease-in-out border border-green-100",
                step.position === "right" && "ml-4",
                step.position === "left" && "mr-4",
                step.position === "bottom" && "mt-4",
                step.position === "top" && "mb-4"
              )}
              style={{
                top:
                  step.position === "bottom"
                    ? coords.top + coords.height + 20
                    : step.position === "top"
                    ? coords.top - 200
                    : coords.top + coords.height / 2 - 100,
                left:
                  step.position === "right"
                    ? coords.left + coords.width + 20
                    : step.position === "left"
                    ? coords.left - 340
                    : coords.left + coords.width / 2 - 160,
              }}
            >
              <button
                onClick={() => setIsOpen(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-green-50 rounded-lg">{step.icon}</div>
                <h3 className="font-bold text-gray-900">{step.title}</h3>
              </div>

              <p className="text-sm text-gray-600 leading-relaxed mb-6">
                {step.description}
              </p>

              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {TOUR_STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-1.5 w-1.5 rounded-full transition-all duration-300",
                        i === currentStep ? "w-4 bg-green-600" : "bg-gray-200"
                      )}
                    />
                  ))}
                </div>

                <div className="flex gap-2">
                  {currentStep > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={prevStep}
                      className="h-8 px-2 text-gray-500"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Back
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={nextStep}
                    className="h-8 px-4 bg-green-600 hover:bg-green-700 text-white shadow-sm transition-all hover:scale-105"
                  >
                    {currentStep === TOUR_STEPS.length - 1 ? "Finish" : "Next"}
                    {currentStep < TOUR_STEPS.length - 1 && (
                      <ChevronRight className="h-4 w-4 ml-1" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
