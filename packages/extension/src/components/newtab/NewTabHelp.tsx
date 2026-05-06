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
  ExternalLink,
  Bookmark,
  Layout,
  Info,
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
      "Search across eBay, PriceCharting, Shopify, and more. Your recently closed tabs and history are also right here.",
    icon: <Search className="h-5 w-5 text-green-600" />,
    position: "right",
  },
  {
    targetId: "tour-search-google",
    title: "Google Search",
    description:
      "The default search engine for all your general inquiries and web browsing.",
    icon: <Search className="h-5 w-5 text-green-600" />,
    position: "bottom",
    mode: "google",
  },
  {
    targetId: "tour-search-pricecharting",
    title: "PriceCharting Search",
    description:
      "Quickly look up game and card prices across the PriceCharting database.",
    icon: <TrendingUp className="h-5 w-5 text-green-600" />,
    position: "bottom",
    mode: "pricecharting",
  },
  {
    targetId: "tour-search-upc",
    title: "UPC Lookup",
    description:
      "Find product details instantly by searching with a barcode or UPC number.",
    icon: <Barcode className="h-5 w-5 text-green-600" />,
    position: "bottom",
    mode: "barcodelookup",
  },
  {
    targetId: "tour-search-ebay",
    title: "eBay Sold Prices",
    description:
      "Check actual sold prices on eBay to accurately value your items.",
    icon: <Tag className="h-5 w-5 text-green-600" />,
    position: "bottom",
    mode: "ebay",
  },
  {
    targetId: "tour-search-shopify",
    title: "Shopify Inventory",
    description:
      "Search through your Shopify store's inventory directly from your new tab.",
    icon: <Store className="h-5 w-5 text-green-600" />,
    position: "bottom",
    mode: "shopify",
  },
  {
    targetId: "tour-quick-links",
    title: "Quick Links",
    description:
      "Your most important resale platforms and tools, organized for one-click access.",
    icon: <ExternalLink className="h-5 w-5 text-green-600" />,
    position: "left",
  },
  {
    targetId: "tour-bookmarks",
    title: "Browser Bookmarks",
    description:
      "Access your Chrome bookmarks without leaving the page. Stays perfectly in sync.",
    icon: <Bookmark className="h-5 w-5 text-green-600" />,
    position: "left",
  },
  {
    targetId: "tour-tools",
    title: "Sidepanel Tools",
    description:
      "Quickly open specialized tools like Price Checkers and Inventory Managers in the Chrome sidepanel.",
    icon: <Layout className="h-5 w-5 text-green-600" />,
    position: "bottom",
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
    if (el) {
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
