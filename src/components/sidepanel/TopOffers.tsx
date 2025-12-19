/* global chrome */
"use client";

import { useState, useEffect } from "react";
import { Input } from "../ui/input";
import { Check, Pencil } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import SidepanelLayout from "./SidepanelLayout";

interface RateRule {
  threshold: number;
  percentage: number;
}

interface CustomRates {
  standard: {
    rules: RateRule[];
    defaultPercentage: number;
  };
  premium: {
    rules: RateRule[];
    defaultPercentage: number;
  };
  checkout?: {
    percentage: number;
  };
}

// Helper function to implement FLOOR functionality
function floorToMultiple(value: number, multiple: number): number {
  return Math.floor(value / multiple) * multiple;
}

// Helper function to format numbers with commas
function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// Top Offer calculation logic
function calculateTopOffer(
  projection: number,
  customRates?: CustomRates
): number {
  if (customRates) {
    for (const rule of customRates.standard.rules) {
      if (projection < rule.threshold) {
        return floorToMultiple(projection * rule.percentage, 5);
      }
    }
    return floorToMultiple(
      projection * customRates.standard.defaultPercentage,
      5
    );
  }

  // Standard Logic
  if (projection < 50) {
    return floorToMultiple(projection * 0.2, 5);
  } else if (projection < 100) {
    return floorToMultiple(projection * 0.3, 5);
  } else if (projection < 250) {
    return floorToMultiple(projection * 0.35, 5);
  } else if (projection < 500) {
    return floorToMultiple(projection * 0.45, 5);
  } else if (projection < 750) {
    return floorToMultiple(projection * 0.5, 5);
  } else {
    return floorToMultiple(projection * 0.6, 5);
  }
}

// Premium Top Offer calculation logic
function calculateTopOfferPremium(
  projection: number,
  customRates?: CustomRates
): number {
  if (customRates) {
    for (const rule of customRates.premium.rules) {
      if (projection < rule.threshold) {
        return floorToMultiple(projection * rule.percentage, 5);
      }
    }
    return floorToMultiple(
      projection * customRates.premium.defaultPercentage,
      5
    );
  }

  // Standard Logic
  if (projection < 50) {
    return floorToMultiple(projection * 0.2, 5);
  } else if (projection < 100) {
    return floorToMultiple(projection * 0.3, 5);
  } else if (projection < 200) {
    return floorToMultiple(projection * 0.35, 5);
  } else if (projection < 250) {
    return floorToMultiple(projection * 0.45, 5);
  } else if (projection < 500) {
    return floorToMultiple(projection * 0.55, 5);
  } else if (projection < 750) {
    return floorToMultiple(projection * 0.6, 5);
  } else {
    return floorToMultiple(projection * 0.7, 5);
  }
}

// Top Offer Calculator Component
function TopOfferCalculator() {
  const [projectionAmount, setProjectionAmount] = useState("");
  const [customRates, setCustomRates] = useState<CustomRates | undefined>(
    undefined
  );
  const [results, setResults] = useState({
    topOffer: 0,
    topOfferPremium: 0,
    topOfferCheckout: 0,
  });
  const [copied, setCopied] = useState<string | null>(null);

  // Load settings from storage on mount
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      // Load settings
      chrome.storage.sync.get(["cmdkSettings"], (result) => {
        if (result.cmdkSettings?.topOffers?.customRates) {
          setCustomRates(result.cmdkSettings.topOffers.customRates);
        }
      });

      // Listen for changes
      const handleStorageChange = (
        changes: { [key: string]: chrome.storage.StorageChange },
        areaName: string
      ) => {
        if (areaName === "sync" && changes.cmdkSettings) {
          const newSettings = changes.cmdkSettings.newValue;
          if (newSettings?.topOffers?.customRates) {
            setCustomRates(newSettings.topOffers.customRates);
          }
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, []);

  // Recalculate when custom rates changes
  useEffect(() => {
    if (projectionAmount) {
      handleProjectionChange(projectionAmount);
    }
  }, [customRates]);

  const handleCopy = (amount: number, id: string) => {
    navigator.clipboard.writeText(amount.toString());
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleProjectionChange = (value: string) => {
    const numericValue = value.replace(/[^0-9.-]/g, "");
    setProjectionAmount(numericValue);

    // Auto-calculate when input changes
    const projection = parseFloat(numericValue) || 0;
    const topOffer = calculateTopOffer(projection, customRates);
    const topOfferPremium = calculateTopOfferPremium(projection, customRates);
    const checkoutRate = customRates?.checkout?.percentage ?? 0.8;
    const topOfferCheckout = floorToMultiple(projection * checkoutRate, 5);

    setResults({
      topOffer,
      topOfferPremium,
      topOfferCheckout,
    });
  };

  const openSettings = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof chrome !== "undefined" && chrome.runtime) {
      chrome.runtime.sendMessage({
        action: "open-settings",
        section: "topoffers",
      });
    }
  };

  return (
    <SidepanelLayout>
      <div className="p-4 space-y-4">
        <div className="space-y-4">
          <div className="relative">
            <Input
              type="text"
              value={projectionAmount}
              onChange={(e) => handleProjectionChange(e.target.value)}
              className="text-lg h-12 bg-slate-50 focus:bg-white pr-12"
              placeholder="Enter Projection"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={openSettings}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-md transition-colors flex items-center justify-center"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="border-border bg-popover text-popover-foreground">
                  <p>Change Rates</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div
              onClick={() => handleCopy(results.topOffer, "standard")}
              className="text-center p-4 bg-secondary/50 rounded-lg border border-border/50 cursor-pointer hover:bg-secondary transition-colors select-none"
            >
              <div className="text-3xl font-bold text-primary">
                ${formatCurrency(results.topOffer)}
              </div>
              <div className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1.5">
                {copied === "standard" ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-green-500 font-medium">Copied!</span>
                  </>
                ) : (
                  "Top Offer"
                )}
              </div>
            </div>

            <div
              onClick={() => handleCopy(results.topOfferPremium, "premium")}
              className="text-center p-4 bg-secondary/50 rounded-lg border border-border/50 cursor-pointer hover:bg-secondary transition-colors select-none"
            >
              <div className="text-3xl font-bold text-primary">
                ${formatCurrency(results.topOfferPremium)}
              </div>
              <div className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1.5">
                {copied === "premium" ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-green-500 font-medium">Copied!</span>
                  </>
                ) : (
                  "Top Offer (Premium)"
                )}
              </div>
            </div>

            <div
              onClick={() => handleCopy(results.topOfferCheckout, "checkout")}
              className="text-center p-4 bg-secondary/50 rounded-lg border border-border/50 cursor-pointer hover:bg-secondary transition-colors select-none"
            >
              <div className="text-3xl font-bold text-primary">
                ${formatCurrency(results.topOfferCheckout)}
              </div>
              <div className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1.5">
                {copied === "checkout" ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-green-500 font-medium">Copied!</span>
                  </>
                ) : (
                  "Top Offer (Checkout)"
                )}
              </div>
            </div>
          </div>

          {/* Current Rates Display */}
          <div className="pt-2 border-t border-border/50 space-y-4">
            {/* Standard Rates */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2 px-1">
                Standard Rates
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-1">
                {customRates ? (
                  <>
                    {customRates.standard.rules.map((rule, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          Under ${rule.threshold}
                        </span>
                        <span className="font-semibold text-foreground">
                          {Math.round(rule.percentage * 100)}%
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        $
                        {
                          customRates.standard.rules[
                            customRates.standard.rules.length - 1
                          ]?.threshold
                        }
                        +
                      </span>
                      <span className="font-semibold text-foreground">
                        {Math.round(
                          customRates.standard.defaultPercentage * 100
                        )}
                        %
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Under $50</span>
                      <span className="font-semibold text-foreground">20%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$50–$99</span>
                      <span className="font-semibold text-foreground">30%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$100–$249</span>
                      <span className="font-semibold text-foreground">35%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$250–$499</span>
                      <span className="font-semibold text-foreground">45%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$500–$749</span>
                      <span className="font-semibold text-foreground">50%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$750+</span>
                      <span className="font-semibold text-foreground">60%</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Premium Rates */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2 px-1">
                Premium Rates
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-1">
                {customRates ? (
                  <>
                    {customRates.premium.rules.map((rule, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          Under ${rule.threshold}
                        </span>
                        <span className="font-semibold text-foreground">
                          {Math.round(rule.percentage * 100)}%
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        $
                        {
                          customRates.premium.rules[
                            customRates.premium.rules.length - 1
                          ]?.threshold
                        }
                        +
                      </span>
                      <span className="font-semibold text-foreground">
                        {Math.round(
                          customRates.premium.defaultPercentage * 100
                        )}
                        %
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Under $50</span>
                      <span className="font-semibold text-foreground">20%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$50–$99</span>
                      <span className="font-semibold text-foreground">30%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$100–$199</span>
                      <span className="font-semibold text-foreground">35%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$200–$249</span>
                      <span className="font-semibold text-foreground">45%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$250–$499</span>
                      <span className="font-semibold text-foreground">55%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$500–$749</span>
                      <span className="font-semibold text-foreground">60%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">$750+</span>
                      <span className="font-semibold text-foreground">70%</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Checkout Rate */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2 px-1">
                Checkout Rate
              </div>
              <div className="px-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">All amounts</span>
                  <span className="font-semibold text-foreground">
                    {Math.round(
                      (customRates?.checkout?.percentage ?? 0.8) * 100
                    )}
                    %
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SidepanelLayout>
  );
}

export default function TopOffersPage({ onClose }: { onClose?: () => void }) {
  return <TopOfferCalculator />;
}
