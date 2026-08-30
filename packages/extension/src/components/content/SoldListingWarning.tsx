import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Settings, X } from "lucide-react";
import {
  buildEbaySoldListingsUrl,
  getEbayListingState,
  type EbayListingState,
} from "../../domain/ebay-sold-listings";
import type { SyncStorageResult } from "../../types/settings";

interface SoldListingWarningProps {
  onDismiss: () => void;
}

interface SoldListingWarningSettingsMessage {
  action?: unknown;
  enabled?: unknown;
}

const SoldListingWarning: React.FC<SoldListingWarningProps> = ({ onDismiss }) => {
  const [listingState, setListingState] = useState<EbayListingState>("active");
  const [isEnabled, setIsEnabled] = useState<boolean>(true);

  // Update state from URL
  useEffect(() => {
    const updateState = () => {
      const state = getEbayListingState(window.location.href);
      setListingState((prev) => {
        if (prev !== state) return state;
        return prev;
      });
    };

    updateState();

    // Listen for URL changes (e.g., navigation)
    const handlePopState = () => updateState();
    window.addEventListener("popstate", handlePopState);

    // Also check periodically for programmatic URL changes (eBay uses SPA navigation)
    const interval = setInterval(updateState, 500);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      clearInterval(interval);
    };
  }, []);

  // Check if feature is enabled
  useEffect(() => {
    const checkEnabled = async () => {
      try {
        const result = (await chrome.storage.sync.get([
          "cmdkSettings",
        ])) as SyncStorageResult;
        const enabled = result.cmdkSettings?.soldListingWarning?.enabled ?? true;
        setIsEnabled(enabled);
      } catch (err) {
        console.error("[Volt Sold Listing Warning] Failed to check settings", err);
        setIsEnabled(true);
      }
    };

    checkEnabled();

    // Listen for settings changes
    const handleMessage = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const settingsMessage = message as SoldListingWarningSettingsMessage;
      if (settingsMessage.action === "sold-listing-warning-settings-changed") {
        setIsEnabled(
          typeof settingsMessage.enabled === "boolean"
            ? settingsMessage.enabled
            : true
        );
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const handleSettings = useCallback(() => {
    chrome.runtime.sendMessage({
      action: "open-settings",
      section: "ebay",
    });
  }, []);

  const handleSwitchToSold = useCallback(() => {
    window.location.href = buildEbaySoldListingsUrl(window.location.href);
  }, []);

  if (!isEnabled || listingState === "sold") {
    return null;
  }

  const message = listingState === "completed"
    ? "Completed results can include unsold items. Use sold listings for real pricing."
    : "Active listings are asking prices, not market comps. Switch to sold listings before pricing.";
  const title = listingState === "completed"
    ? "Completed listings"
    : "Active listings";

  return (
    <section
      id="volt-sold-listing-warning"
      className={`volt-sold-listing-warning volt-state-${listingState}`}
      aria-live="polite"
    >
      <div className="volt-sold-listing-warning__header">
        <AlertTriangle
          className="volt-sold-listing-warning__status-icon"
          size={17}
          aria-hidden="true"
        />
        <h2 className="volt-sold-listing-warning__title">{title}</h2>
        <div className="volt-sold-listing-warning__actions">
          <button
            className="volt-sold-listing-warning__settings"
            onClick={handleSettings}
            type="button"
            title="Warning settings"
            aria-label="Open warning settings"
          >
            <Settings size={15} />
          </button>
          <button
            className="volt-sold-listing-warning__dismiss"
            onClick={onDismiss}
            type="button"
            title="Dismiss"
            aria-label="Dismiss warning"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <p className="volt-sold-listing-warning__content">{message}</p>
      <button
        className="volt-sold-listing-warning__primary"
        type="button"
        onClick={handleSwitchToSold}
      >
        View sold listings
      </button>
    </section>
  );
};

export default SoldListingWarning;
