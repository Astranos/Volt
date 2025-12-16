/* global chrome */
"use client";

import { useState, useEffect } from "react";
import { Input } from "../ui/input";
import { Check, Settings } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
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
    const topOfferCheckout = floorToMultiple(projection * 0.8, 5);

    setResults({
      topOffer,
      topOfferPremium,
      topOfferCheckout,
    });
  };

  const openSettings = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.openOptionsPage
    ) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("/options.html"));
    }
  };

  return (
    <SidepanelLayout>
      <div className="p-4 space-y-4">
        <div className="space-y-4">
          <div className="space-y-3">
            <Input
              type="text"
              value={projectionAmount}
              onChange={(e) => handleProjectionChange(e.target.value)}
              className="text-lg h-12 bg-slate-50 focus:bg-white"
              placeholder="Enter estimated projection"
            />
          </div>

          {/* Results Section */}
          <div className="space-y-4">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="info" className="border-none">
                <div className="flex items-center justify-between w-full">
                  <AccordionTrigger className="py-2 text-sm text-muted-foreground hover:no-underline justify-start gap-2 flex-1">
                    <span>How offers are calculated</span>
                  </AccordionTrigger>
                  <button
                    onClick={openSettings}
                    className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
                    title="Open Settings"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
                <AccordionContent>
                  <div className="space-y-4 text-sm text-muted-foreground pt-2">
                    <div>
                      <h6 className="font-semibold text-foreground mb-1">
                        Top Offer
                      </h6>
                      <p className="mb-1.5">
                        Standard offer calculated as a percentage of projection,
                        rounded down to the nearest $5.
                      </p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5 text-xs">
                        {customRates ? (
                          <>
                            {customRates.standard.rules.map((rule, i) => (
                              <li key={i}>
                                Under ${rule.threshold}:{" "}
                                <strong>
                                  {Math.round(rule.percentage * 100)}%
                                </strong>
                              </li>
                            ))}
                            <li>
                              $
                              {
                                customRates.standard.rules[
                                  customRates.standard.rules.length - 1
                                ]?.threshold
                              }
                              +:{" "}
                              <strong>
                                {Math.round(
                                  customRates.standard.defaultPercentage * 100
                                )}
                                %
                              </strong>
                            </li>
                          </>
                        ) : (
                          <>
                            <li>
                              Under $50: <strong>20%</strong>
                            </li>
                            <li>
                              $50–$99.99: <strong>30%</strong>
                            </li>
                            <li>
                              $100–$249.99: <strong>35%</strong>
                            </li>
                            <li>
                              $250–$499.99: <strong>45%</strong>
                            </li>
                            <li>
                              $500–$749.99: <strong>50%</strong>
                            </li>
                            <li>
                              $750+: <strong>60%</strong>
                            </li>
                          </>
                        )}
                      </ul>
                    </div>

                    <div>
                      <h6 className="font-semibold text-foreground mb-1">
                        Top Offer (Premium)
                      </h6>
                      <p>
                        Higher offer for premium items with better rates for
                        larger projections, rounded down to the nearest $5.
                      </p>
                    </div>

                    <div>
                      <h6 className="font-semibold text-foreground mb-1">
                        Top Offer (Checkout)
                      </h6>
                      <p>
                        Always <strong>80%</strong> of projection, rounded down
                        to the nearest $5. Highest offer amount.
                      </p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

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
                      <span className="text-green-500 font-medium">
                        Copied!
                      </span>
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
                      <span className="text-green-500 font-medium">
                        Copied!
                      </span>
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
                      <span className="text-green-500 font-medium">
                        Copied!
                      </span>
                    </>
                  ) : (
                    "Top Offer (Checkout)"
                  )}
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
