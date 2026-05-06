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
import type {
  CustomOffer,
  CustomRates,
  RateRule,
  SyncStorageChanges,
  SyncStorageResult,
  TopOffersSettings,
} from "../../types/settings";

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

// Default rate definitions
const DEFAULT_STANDARD_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.2 },
  { threshold: 100, percentage: 0.3 },
  { threshold: 250, percentage: 0.35 },
  { threshold: 500, percentage: 0.45 },
  { threshold: 750, percentage: 0.5 },
];
const DEFAULT_STANDARD_DEFAULT_PERCENTAGE = 0.6;

const DEFAULT_PREMIUM_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.2 },
  { threshold: 100, percentage: 0.3 },
  { threshold: 200, percentage: 0.35 },
  { threshold: 250, percentage: 0.45 },
  { threshold: 500, percentage: 0.55 },
  { threshold: 750, percentage: 0.6 },
];
const DEFAULT_PREMIUM_DEFAULT_PERCENTAGE = 0.7;
const DEFAULT_CHECKOUT_PERCENTAGE = 0.8;

// Helper function to check if a standard rate is custom
function isStandardRateCustom(
  threshold: number | undefined,
  percentage: number,
  customRates?: CustomRates
): boolean {
  if (!customRates) return false;

  if (threshold === undefined) {
    // This is the default percentage
    return (
      Math.abs(
        customRates.standard.defaultPercentage -
          DEFAULT_STANDARD_DEFAULT_PERCENTAGE
      ) > 0.001
    );
  }

  const defaultRule = DEFAULT_STANDARD_RULES.find(
    (r) => r.threshold === threshold
  );
  if (!defaultRule) return true; // New threshold, must be custom

  return Math.abs(defaultRule.percentage - percentage) > 0.001;
}

// Helper function to check if a premium rate is custom
function isPremiumRateCustom(
  threshold: number | undefined,
  percentage: number,
  customRates?: CustomRates
): boolean {
  if (!customRates) return false;

  if (threshold === undefined) {
    // This is the default percentage
    return (
      Math.abs(
        customRates.premium.defaultPercentage -
          DEFAULT_PREMIUM_DEFAULT_PERCENTAGE
      ) > 0.001
    );
  }

  const defaultRule = DEFAULT_PREMIUM_RULES.find(
    (r) => r.threshold === threshold
  );
  if (!defaultRule) return true; // New threshold, must be custom

  return Math.abs(defaultRule.percentage - percentage) > 0.001;
}

// Helper function to check if checkout rate is custom
function isCheckoutRateCustom(customRates?: CustomRates): boolean {
  if (!customRates?.checkout) return false;
  return (
    Math.abs(customRates.checkout.percentage - DEFAULT_CHECKOUT_PERCENTAGE) >
    0.001
  );
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

// Helper function to calculate custom offer value
function calculateCustomOffer(projection: number, offer: CustomOffer): number {
  for (const rule of offer.rules) {
    if (projection < rule.threshold) {
      return floorToMultiple(projection * rule.percentage, 5);
    }
  }
  return floorToMultiple(projection * offer.defaultPercentage, 5);
}

// Top Offer Calculator Component
function TopOfferCalculator() {
  const [projectionAmount, setProjectionAmount] = useState("");
  const [topOffersSettings, setTopOffersSettings] = useState<TopOffersSettings>(
    {}
  );
  const [results, setResults] = useState({
    topOffer: 0,
    topOfferPremium: 0,
    topOfferCheckout: 0,
  });
  const [customOfferResults, setCustomOfferResults] = useState<
    { id: string; name: string; value: number }[]
  >([]);
  const [copied, setCopied] = useState<string | null>(null);

  // Load settings from storage on mount
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      // Load settings
      chrome.storage.sync.get(["cmdkSettings"], (result: SyncStorageResult) => {
        if (result.cmdkSettings?.topOffers) {
          setTopOffersSettings(result.cmdkSettings.topOffers);
        }
      });

      // Listen for changes
      const handleStorageChange = (
        changes: SyncStorageChanges,
        areaName: string
      ) => {
        if (areaName === "sync" && changes.cmdkSettings) {
          const newSettings = changes.cmdkSettings.newValue;
          if (newSettings?.topOffers) {
            setTopOffersSettings(newSettings.topOffers);
          }
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, []);

  // Recalculate when settings change
  useEffect(() => {
    if (projectionAmount) {
      handleProjectionChange(projectionAmount);
    }
  }, [topOffersSettings]);

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
    const customRates = topOffersSettings.customRates;
    const topOffer = calculateTopOffer(projection, customRates);
    const topOfferPremium = calculateTopOfferPremium(projection, customRates);
    const checkoutRate = customRates?.checkout?.percentage ?? 0.8;
    const topOfferCheckout = floorToMultiple(projection * checkoutRate, 5);

    setResults({
      topOffer,
      topOfferPremium,
      topOfferCheckout,
    });

    // Calculate custom offers
    const customOffers = topOffersSettings.customOffers || [];
    const customResults = customOffers.map((offer) => ({
      id: offer.id,
      name: offer.name,
      value: calculateCustomOffer(projection, offer),
    }));
    setCustomOfferResults(customResults);
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
          <div>
            <Input
              type="text"
              value={projectionAmount}
              onChange={(e) => handleProjectionChange(e.target.value)}
              className="text-lg h-12 bg-slate-50 focus:bg-white"
              placeholder="Enter Projection"
            />
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

            {/* Custom Offers */}
            {(topOffersSettings.customOffers || []).map((offer) => {
              const result = customOfferResults.find((r) => r.id === offer.id);
              const value = result?.value ?? 0;
              return (
                <div
                  key={offer.id}
                  onClick={() => handleCopy(value, offer.id)}
                  className="text-center p-4 bg-secondary/50 rounded-lg border border-border/50 cursor-pointer hover:bg-secondary transition-colors select-none"
                >
                  <div className="text-3xl font-bold text-primary">
                    ${formatCurrency(value)}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1.5">
                    {copied === offer.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-green-500" />
                        <span className="text-green-500 font-medium">
                          Copied!
                        </span>
                      </>
                    ) : (
                      offer.name
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Customize Button */}
          <div className="pt-2 border-t border-border/50">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={openSettings}
                    className="w-full h-9 px-2 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-md transition-colors flex items-center justify-center gap-1.5 text-sm"
                  >
                    <span>Customize</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent className="border-border bg-popover text-popover-foreground">
                  <p>Customize</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </SidepanelLayout>
  );
}

export default function TopOffersPage({ onClose }: { onClose?: () => void }) {
  return <TopOfferCalculator />;
}
