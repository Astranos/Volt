import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/button";
import {
  HelpCircle,
  ChevronRight,
  ChevronLeft,
  X,
  Search,
  TrendingUp,
  MousePointer2,
  ListPlus,
  Settings2,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface TourStep {
  targetId: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  position: "bottom" | "top" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "tour-pc-search",
    title: "UPC & Game Search",
    description:
      "Quickly find any game or card by entering its name or UPC/Barcode number.",
    icon: <Search className="h-5 w-5 text-green-600" />,
    position: "bottom",
  },
  {
    targetId: "tour-pc-open-site",
    title: "Open PriceCharting",
    description:
      "Click here to open the PriceCharting website in a popup or new tab to see full market details and recent sales.",
    icon: <TrendingUp className="h-5 w-5 text-green-600" />,
    position: "bottom",
  },
  {
    targetId: "tour-pc-instruction",
    title: "One-Click Lot Building",
    description:
      "When browsing PriceCharting.com, look for the 'Add To Game Lot' buttons added by Scout. Click them to instantly add prices to your list.",
    icon: <MousePointer2 className="h-5 w-5 text-green-600" />,
    position: "bottom",
  },
  {
    targetId: "tour-pc-lot-summary",
    title: "Lot Overview",
    description:
      "Track your total lot value and item count in real-time as you add new games and cards.",
    icon: <ListPlus className="h-5 w-5 text-green-600" />,
    position: "bottom",
  },
  {
    targetId: "tour-pc-total-value",
    title: "Market Valuation",
    description:
      "Instantly see the combined market value of your entire lot based on the latest PriceCharting data.",
    icon: <TrendingUp className="h-5 w-5 text-green-600" />,
    position: "top",
  },
  {
    targetId: "tour-pc-lot-items",
    title: "Manage Your Lot",
    description:
      "Review added items, adjust quantities, copy UPCs, or view deep game details right here in the sidepanel.",
    icon: <Settings2 className="h-5 w-5 text-green-600" />,
    position: "top",
  },
];

export function PriceChartingHelp() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

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

      // Responsive positioning for sidepanel
      const tooltipWidth = Math.min(window.innerWidth - 32, 280);
      const padding = 16;

      let left = rect.left + rect.width / 2 - tooltipWidth / 2;

      if (step.position === "right") {
        left = rect.left + rect.width + 12;
      } else if (step.position === "left") {
        left = rect.left - tooltipWidth - 12;
      }

      // Final clamping to ensure it stays on screen
      left = Math.max(
        padding,
        Math.min(window.innerWidth - tooltipWidth - padding, left)
      );

      let top = rect.top + rect.height / 2 - 90;
      if (step.position === "bottom") {
        top = rect.top + rect.height + 12;
      } else if (step.position === "top") {
        top = rect.top - 180;
      }

      setTooltipStyle({
        top,
        left,
        width: tooltipWidth,
      });
    }
  }, [currentStep]);

  useEffect(() => {
    if (isOpen) {
      updateCoords();
      // Add a small delay to ensure elements are rendered and positioned
      const timer = setTimeout(updateCoords, 100);
      window.addEventListener("resize", updateCoords);
      return () => {
        window.removeEventListener("resize", updateCoords);
        clearTimeout(timer);
      };
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
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-green-600 transition-colors"
        onClick={() => {
          setIsOpen(true);
          setCurrentStep(0);
        }}
        title="View Guide"
      >
        <HelpCircle className="h-4 w-4" />
      </Button>

      {isOpen &&
        coords &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
            {/* SVG Overlay with Hole */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <defs>
                <mask id="pc-tour-mask">
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
                mask="url(#pc-tour-mask)"
                className="pointer-events-auto"
                onClick={() => setIsOpen(false)}
              />
            </svg>

            {/* Tooltip Content */}
            <div
              className={cn(
                "absolute z-[101] bg-white rounded-xl shadow-2xl p-5 transition-all duration-300 ease-in-out border border-green-100",
                step.position === "right" && "ml-4",
                step.position === "left" && "mr-4",
                step.position === "bottom" && "mt-4",
                step.position === "top" && "mb-4"
              )}
              style={tooltipStyle}
            >
              <button
                onClick={() => setIsOpen(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-green-50 rounded-lg">{step.icon}</div>
                <h3 className="font-bold text-gray-900 text-sm">{step.title}</h3>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed mb-6">
                {step.description}
              </p>

              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {TOUR_STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-1 w-1 rounded-full transition-all duration-300",
                        i === currentStep ? "w-3 bg-green-600" : "bg-gray-200"
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
                      className="h-7 px-2 text-gray-500 text-[11px]"
                    >
                      <ChevronLeft className="h-3 w-3 mr-1" />
                      Back
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={nextStep}
                    className="h-7 px-3 bg-green-600 hover:bg-green-700 text-white shadow-sm transition-all text-[11px]"
                  >
                    {currentStep === TOUR_STEPS.length - 1 ? "Finish" : "Next"}
                    {currentStep < TOUR_STEPS.length - 1 && (
                      <ChevronRight className="h-3 w-3 ml-1" />
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

