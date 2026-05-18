/* global chrome */
"use client";

import { useState, useEffect } from "react";
import { Input } from "../ui/input";
import { Check } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import SidepanelLayout from "./SidepanelLayout";
import type {
  SyncStorageChanges,
  SyncStorageResult,
  TopOffersSettings,
} from "../../types/settings";
import {
  calculateTopOfferResults,
  formatCurrency,
} from "../../domain/top-offers";

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
    const calculated = calculateTopOfferResults(projection, topOffersSettings);

    setResults({
      topOffer: calculated.topOffer,
      topOfferPremium: calculated.topOfferPremium,
      topOfferCheckout: calculated.topOfferCheckout,
    });
    setCustomOfferResults(calculated.customOffers);
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
