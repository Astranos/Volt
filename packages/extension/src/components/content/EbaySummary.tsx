import React, { useEffect, useState, useCallback } from "react";
import { Settings, X } from "lucide-react";
import type { SyncStorageResult } from "../../types/settings";

type ListingState = "sold" | "completed" | "active" | "unknown";

interface EbaySummaryProps {
  onDismiss: () => void;
}

const EbaySummary: React.FC<EbaySummaryProps> = ({ onDismiss }) => {
  const [listingState, setListingState] = useState<ListingState>("active");
  const [conditionText, setConditionText] = useState<string>("All Conditions");
  const [isEnabled, setIsEnabled] = useState<boolean>(true);
  const [iconUrl, setIconUrl] = useState<string>("");

  // Get listing state from URL
  const getListingState = useCallback((): ListingState => {
    try {
      const url = new URL(window.location.href);
      if (!/\.ebay\./i.test(url.hostname)) return "unknown";
      if (!url.pathname.startsWith("/sch/")) return "unknown";

      const soldParam = url.searchParams.get("LH_Sold");
      const completeParam = url.searchParams.get("LH_Complete");

      const isSold = soldParam === "1" || soldParam === "true";
      const isComplete = completeParam === "1" || completeParam === "true";

      if (isSold) return "sold";
      if (isComplete) return "completed";
      return "active";
    } catch {
      return "active";
    }
  }, []);

  // Get conditions text from URL
  const getConditionsText = useCallback(
    (conditionParam: string | null): string => {
      if (!conditionParam) return "All Conditions";

      const decoded = decodeURIComponent(conditionParam);
      const codes = decoded.split("|");

      const labels = new Set<string>();

      codes.forEach((code) => {
        if (["1000", "3", "10"].includes(code)) labels.add("New");
        else if (["1500", "1750"].includes(code)) labels.add("Open Box");
        else if (code >= "2000" && code <= "2500") labels.add("Refurbished");
        else if (["3000", "4", "5000", "6000"].includes(code))
          labels.add("Used");
        else if (["7000"].includes(code)) labels.add("Broken");
        else labels.add("Other");
      });

      if (labels.size === 0) return "All Conditions";

      const labelArray = Array.from(labels);
      if (labelArray.length <= 2) {
        return labelArray.join(" & ");
      }
      return labelArray.join(", ");
    },
    []
  );

  // Update state from URL
  useEffect(() => {
    const updateState = () => {
      const state = getListingState();
      setListingState((prev) => {
        if (prev !== state) return state;
        return prev;
      });

      const url = new URL(window.location.href);
      const conditionParam = url.searchParams.get("LH_ItemCondition");
      const newConditionText = getConditionsText(conditionParam);
      setConditionText((prev) => {
        if (prev !== newConditionText) return newConditionText;
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
  }, [getListingState, getConditionsText]);

  // Check if feature is enabled
  useEffect(() => {
    const checkEnabled = async () => {
      try {
        const result = (await chrome.storage.sync.get([
          "cmdkSettings",
        ])) as SyncStorageResult;
        const enabled = result.cmdkSettings?.ebaySummary?.enabled ?? true;
        setIsEnabled(enabled);
      } catch (err) {
        console.error("[Volt eBay Summary] Failed to check settings", err);
        setIsEnabled(true);
      }
    };

    checkEnabled();

    // Listen for settings changes
    const handleMessage = (message: any) => {
      if (message.action === "ebay-summary-settings-changed") {
        setIsEnabled(message.enabled ?? true);
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
      console.error("[Volt eBay Summary] Failed to get icon URL", err);
    }
  }, []);

  const handleSettings = useCallback(() => {
    chrome.runtime.sendMessage({
      action: "open-settings",
      section: "ebay",
    });
  }, []);

  const handleSwitchToSold = useCallback(() => {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("LH_Sold", "1");
    currentUrl.searchParams.set("LH_Complete", "1");
    window.location.href = currentUrl.toString();
  }, []);

  const handleFilter = useCallback((conditionCode: string | null) => {
    const currentUrl = new URL(window.location.href);
    if (conditionCode) {
      currentUrl.searchParams.set("LH_ItemCondition", conditionCode);
    } else {
      currentUrl.searchParams.delete("LH_ItemCondition");
    }
    window.location.href = currentUrl.toString();
  }, []);

  if (!isEnabled) {
    return null;
  }

  const isSold = listingState === "sold";
  let listingType = "Active Listings";
  if (listingState === "sold") listingType = "Sold Listings";
  else if (listingState === "completed")
    listingType = "Completed Listings (Sold & Unsold)";

  const stateClass = isSold ? "volt-state-sold" : "volt-state-active";

  return (
    <section
      id="volt-ebay-summary"
      className={`volt-ebay-summary ${stateClass}`}
    >
      <h2 className="volt-ebay-summary__title">
        {iconUrl && <img src={iconUrl} alt="Volt Logo" />}
        eBay Summary
      </h2>
      <div className="volt-ebay-summary__content">
        You are currently viewing <strong>{listingType}</strong> for{" "}
        <strong>{conditionText}</strong> items.
        {isSold ? (
          <>
            {conditionText === "All Conditions" && (
              <span className="volt-ebay-summary__links">
                {" "}
                Filter by{" "}
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilter("3000");
                  }}
                >
                  Used
                </a>
                ,{" "}
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilter("1000");
                  }}
                >
                  New
                </a>
                , or{" "}
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilter("7000");
                  }}
                >
                  Broken
                </a>
                .
              </span>
            )}
            {conditionText.includes("New") && (
              <span className="volt-ebay-summary__links">
                {" "}
                Switch to{" "}
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilter("3000");
                  }}
                >
                  Used
                </a>{" "}
                or{" "}
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilter("7000");
                  }}
                >
                  Broken
                </a>
                .
              </span>
            )}
            {conditionText.includes("Used") && (
              <span className="volt-ebay-summary__links">
                {" "}
                Switch to{" "}
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilter("1000");
                  }}
                >
                  New
                </a>{" "}
                or{" "}
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilter("7000");
                  }}
                >
                  Broken
                </a>
                .
              </span>
            )}
            {(conditionText.includes("For Parts") ||
              conditionText.includes("Broken")) && (
              <span className="volt-ebay-summary__links">
                {" "}
                Switch to{" "}
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilter("1000");
                  }}
                >
                  New
                </a>{" "}
                or{" "}
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilter("3000");
                  }}
                >
                  Used
                </a>
                .
              </span>
            )}
          </>
        ) : (
          <span className="volt-ebay-summary__links">
            {" "}
            Ready to analyze prices?{" "}
            <a
              onClick={(e) => {
                e.preventDefault();
                handleSwitchToSold();
              }}
            >
              Switch to Sold Listings
            </a>
            .
          </span>
        )}
      </div>
      <button
        className="volt-ebay-summary__settings"
        onClick={handleSettings}
        title="Settings"
      >
        <Settings size={14} />
      </button>
      <button
        className="volt-ebay-summary__dismiss"
        onClick={onDismiss}
        title="Dismiss"
      >
        <X size={16} />
      </button>
    </section>
  );
};

export default EbaySummary;
