/* global chrome */
"use client";

import { useState, useEffect } from "react";
import { Calculator, Check, Settings } from "lucide-react";
import SidepanelLayout from "./SidepanelLayout";
import { cn } from "../../lib/utils";
import type {
  SyncStorageChanges,
  SyncStorageResult,
  TopOffersSettings,
} from "../../types/settings";
import {
  calculateTopOfferResults,
  formatCurrency,
} from "../../domain/top-offers";

type OfferResult = {
  id: string;
  label: string;
  startingValue: number;
  maxValue: number;
};

function OfferResultCard({
  offer,
  copied,
  onCopy,
}: {
  offer: OfferResult;
  copied: string | null;
  onCopy: (amount: number, id: string) => void;
}) {
  const startingId = `${offer.id}-starting`;
  const maxId = `${offer.id}-max`;

  return (
    <div className="liquid-glass concentric-lg select-none p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-stone-900 dark:text-stone-50">
          {offer.label}
        </div>
        <div className="rounded-full bg-green-500/12 px-2 py-0.5 text-[11px] font-bold text-green-700 dark:text-green-300">
          Cash guide
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onCopy(offer.startingValue, startingId)}
          className="liquid-glass-soft concentric-md min-h-20 px-3 py-3 text-left transition hover:bg-white/60 active:scale-[0.99] dark:hover:bg-white/10"
        >
          <div className="text-[11px] font-bold uppercase tracking-normal text-stone-500 dark:text-stone-400">
            Start
          </div>
          <div className="mt-1 text-[28px] font-bold leading-none text-green-700 dark:text-green-300">
            ${formatCurrency(offer.startingValue)}
          </div>
          {copied === startingId && (
            <div className="mt-2 flex items-center gap-1 text-xs font-bold text-green-700 dark:text-green-300">
              <Check className="h-3 w-3" />
              Copied
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={() => onCopy(offer.maxValue, maxId)}
          className="liquid-glass-soft concentric-md min-h-20 px-3 py-3 text-left transition hover:bg-white/60 active:scale-[0.99] dark:hover:bg-white/10"
        >
          <div className="text-[11px] font-bold uppercase tracking-normal text-stone-500 dark:text-stone-400">
            Max
          </div>
          <div className="mt-1 text-[28px] font-bold leading-none text-green-700 dark:text-green-300">
            ${formatCurrency(offer.maxValue)}
          </div>
          {copied === maxId && (
            <div className="mt-2 flex items-center gap-1 text-xs font-bold text-green-700 dark:text-green-300">
              <Check className="h-3 w-3" />
              Copied
            </div>
          )}
        </button>
      </div>
    </div>
  );
}

function TopOfferCalculator() {
  const [projectionAmount, setProjectionAmount] = useState("");
  const [topOffersSettings, setTopOffersSettings] = useState<TopOffersSettings>(
    {}
  );
  const [results, setResults] = useState({
    startingOffer: 0,
    topOffer: 0,
    startingOfferPremium: 0,
    topOfferPremium: 0,
    startingOfferCheckout: 0,
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
      startingOffer: calculated.startingOffer,
      topOffer: calculated.topOffer,
      startingOfferPremium: calculated.startingOfferPremium,
      topOfferPremium: calculated.topOfferPremium,
      startingOfferCheckout: calculated.startingOfferCheckout,
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
    <SidepanelLayout className="bg-transparent">
      <div className="space-y-4 px-3 pb-4 pt-3">
        <div className="liquid-glass concentric-xl p-3">
          <label className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-normal text-stone-500 dark:text-stone-400">
            <Calculator className="h-3.5 w-3.5" />
            Projected sale price
          </label>
          <div className="liquid-glass-soft concentric-lg flex h-14 items-center gap-2 px-3 transition focus-within:ring-2 focus-within:ring-green-500/50">
            <span className="text-lg font-bold text-stone-400 dark:text-stone-500">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={projectionAmount}
              onChange={(e) => handleProjectionChange(e.target.value)}
              className="h-full min-w-0 flex-1 bg-transparent text-2xl font-bold text-stone-950 outline-none placeholder:text-stone-400 dark:text-stone-50 dark:placeholder:text-stone-600"
              placeholder="0"
            />
          </div>
        </div>

        <div className="space-y-3">
            <OfferResultCard
              offer={{
                id: "standard",
                label: "Offer",
                startingValue: results.startingOffer,
                maxValue: results.topOffer,
              }}
              copied={copied}
              onCopy={handleCopy}
            />

            <OfferResultCard
              offer={{
                id: "premium",
                label: "Premium Offer",
                startingValue: results.startingOfferPremium,
                maxValue: results.topOfferPremium,
              }}
              copied={copied}
              onCopy={handleCopy}
            />

            <OfferResultCard
              offer={{
                id: "checkout",
                label: "Checkout Offer",
                startingValue: results.startingOfferCheckout,
                maxValue: results.topOfferCheckout,
              }}
              copied={copied}
              onCopy={handleCopy}
            />

            {/* Custom Offers */}
            {(topOffersSettings.customOffers || []).map((offer) => {
              const result = customOfferResults.find((r) => r.id === offer.id);
              const value = result?.value ?? 0;
              return (
                <div
                  key={offer.id}
                  onClick={() => handleCopy(value, offer.id)}
                  className="liquid-glass concentric-lg cursor-pointer p-3.5 text-center transition hover:bg-white/60 active:scale-[0.99] dark:hover:bg-white/10"
                >
                  <div className="text-[28px] font-bold leading-none text-green-700 dark:text-green-300">
                    ${formatCurrency(value)}
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-1.5 text-xs font-bold text-stone-500 dark:text-stone-400">
                    {copied === offer.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-green-700 dark:text-green-300" />
                        <span className="text-green-700 dark:text-green-300">
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
          <button
            type="button"
            onClick={openSettings}
            className={cn(
              "liquid-glass-soft concentric-lg flex h-11 w-full items-center justify-center gap-2 text-sm font-bold text-stone-700 transition",
              "hover:bg-white/70 active:scale-[0.99] dark:text-stone-200 dark:hover:bg-white/10",
            )}
          >
            <Settings className="h-4 w-4" />
            Customize
          </button>
        </div>
      </div>
    </SidepanelLayout>
  );
}

export default function TopOffersPage({ onClose }: { onClose?: () => void }) {
  return <TopOfferCalculator />;
}
