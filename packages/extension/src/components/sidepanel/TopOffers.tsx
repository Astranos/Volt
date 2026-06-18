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
  const renderCopyValue = (amount: number, id: string) =>
    copied === id ? (
      <span className="inline-flex min-w-0 items-center gap-1 text-sm font-bold text-green-700 dark:text-green-300">
        <Check className="h-4 w-4 shrink-0" />
        Copied
      </span>
    ) : (
      <span className="top-offers-amount min-w-0 font-bold leading-tight tabular-nums text-green-700 [overflow-wrap:anywhere] dark:text-green-300">
        ${formatCurrency(amount)}
      </span>
    );

  return (
    <div className="top-offers-card top-offers-result-card min-w-0 select-none">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 truncate text-sm font-bold text-stone-900 dark:text-stone-50">
          {offer.label}
        </div>
        <div className="shrink-0 rounded-full bg-green-500/12 px-2 py-0.5 text-[11px] font-bold text-green-700 dark:text-green-300">
          Cash guide
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onCopy(offer.startingValue, startingId)}
          className="top-offers-value-button flex min-w-0 flex-col text-left transition active:scale-[0.99]"
        >
          <div className="text-[11px] font-bold uppercase tracking-normal text-stone-500 dark:text-stone-400">
            Start
          </div>
          <div className="mt-1 flex min-h-8 min-w-0 flex-1 items-center">
            {renderCopyValue(offer.startingValue, startingId)}
          </div>
        </button>
        <button
          type="button"
          onClick={() => onCopy(offer.maxValue, maxId)}
          className="top-offers-value-button flex min-w-0 flex-col text-left transition active:scale-[0.99]"
        >
          <div className="text-[11px] font-bold uppercase tracking-normal text-stone-500 dark:text-stone-400">
            Max
          </div>
          <div className="mt-1 flex min-h-8 min-w-0 flex-1 items-center">
            {renderCopyValue(offer.maxValue, maxId)}
          </div>
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
    startingOfferNewCustomer: 0,
    topOfferNewCustomer: 0,
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
      startingOfferNewCustomer: calculated.startingOfferNewCustomer,
      topOfferNewCustomer: calculated.topOfferNewCustomer,
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
    <SidepanelLayout className="top-offers-root bg-transparent">
      <div className="top-offers-content">
        <div className="top-offers-input-card">
          <label className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-normal text-stone-500 dark:text-stone-400">
            <Calculator className="h-3.5 w-3.5" />
            Projected sale price
          </label>
          <div className="top-offers-input-shell flex items-center gap-2 transition focus-within:ring-2 focus-within:ring-green-500/40">
            <span className="text-lg font-bold text-stone-400 dark:text-stone-500">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={projectionAmount}
              onChange={(e) => handleProjectionChange(e.target.value)}
              className="top-offers-input h-full min-w-0 flex-1 bg-transparent font-bold text-stone-950 outline-none placeholder:text-stone-400 dark:text-stone-50 dark:placeholder:text-stone-600"
              placeholder="0"
            />
          </div>
        </div>

        <div className="top-offers-results-list">
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

            <OfferResultCard
              offer={{
                id: "new-customer",
                label: "New Customer Offer",
                startingValue: results.startingOfferNewCustomer,
                maxValue: results.topOfferNewCustomer,
              }}
              copied={copied}
              onCopy={handleCopy}
            />

            {/* Custom Offers */}
            {(topOffersSettings.customOffers || []).map((offer) => {
              const result = customOfferResults.find((r) => r.id === offer.id);
              const value = result?.value ?? 0;
              return (
                <button
                  type="button"
                  key={offer.id}
                  onClick={() => handleCopy(value, offer.id)}
                  className="top-offers-card top-offers-custom-card flex w-full min-w-0 cursor-pointer flex-col items-center justify-center text-center transition active:scale-[0.99]"
                >
                  <div className="flex h-9 max-w-full items-center justify-center">
                    {copied === offer.id ? (
                      <span className="inline-flex items-center justify-center gap-1.5 text-sm font-bold text-green-700 dark:text-green-300">
                        <Check className="h-4 w-4 shrink-0" />
                        Copied
                      </span>
                    ) : (
                      <span className="top-offers-amount max-w-full font-bold leading-tight tabular-nums text-green-700 [overflow-wrap:anywhere] dark:text-green-300">
                        ${formatCurrency(value)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 max-w-full truncate text-xs font-bold text-stone-500 dark:text-stone-400">
                    {offer.name}
                  </div>
                </button>
              );
            })}
          <button
            type="button"
            onClick={openSettings}
            className={cn(
              "top-offers-secondary-action flex h-11 w-full items-center justify-center gap-2 text-sm font-bold transition",
              "active:scale-[0.99]",
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
