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
  const [iconUrl, setIconUrl] = useState<string>("");

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

  // Get icon URL
  useEffect(() => {
    try {
      setIconUrl(chrome.runtime.getURL("/assets/icons/logo-32.png"));
    } catch (err) {
      console.error("[Volt Sold Listing Warning] Failed to get icon URL", err);
    }
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

  return (
    <section
      id="volt-sold-listing-warning"
      className="volt-sold-listing-warning volt-state-active"
      aria-live="polite"
    >
      <div className="volt-sold-listing-warning__status-icon" aria-hidden="true">
        <AlertTriangle size={20} />
      </div>
      <div className="volt-sold-listing-warning__body">
        <h2 className="volt-sold-listing-warning__title">
          {iconUrl && <img src={iconUrl} alt="" />}
          Active listing warning
        </h2>
        <p className="volt-sold-listing-warning__content">{message}</p>
        <button
          className="volt-sold-listing-warning__primary"
          type="button"
          onClick={handleSwitchToSold}
        >
          View sold listings
        </button>
      </div>
      <button
        className="volt-sold-listing-warning__settings"
        onClick={handleSettings}
        type="button"
        title="Settings"
      >
        <Settings size={14} />
      </button>
      <button
        className="volt-sold-listing-warning__dismiss"
        onClick={onDismiss}
        type="button"
        title="Dismiss"
      >
        <X size={16} />
      </button>
    </section>
  );
};

export default SoldListingWarning;
