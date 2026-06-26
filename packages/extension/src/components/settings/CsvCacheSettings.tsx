import { useState } from "react";
import { Check, Download, RefreshCw, Trash2 } from "lucide-react";
import type { SaveExtensionSettings } from "@/src/hooks/useExtensionSettings";
import type { CmdkSettings } from "@/src/types/settings";

interface CsvCacheSettingsProps {
  settings: CmdkSettings;
  saveSettings: SaveExtensionSettings;
}

export function CsvCacheSettings({
  settings,
  saveSettings,
}: CsvCacheSettingsProps) {
  const [csvCacheCleared, setCsvCacheCleared] = useState(false);
  const [csvRefreshing, setCsvRefreshing] = useState(false);
  const [csvDownloading, setCsvDownloading] = useState(false);

  const handleCsvUrlChange = (url: string) => {
    void saveSettings({
      ...settings,
      csvLinks: {
        ...settings.csvLinks,
        customUrl: url,
      },
    });
  };

  const handleClearCsvCache = () => {
    chrome.storage.local.remove(
      ["csvLinksCache", "csvLinksCacheTimestamp"],
      () => {
        if (chrome.runtime.lastError) {
          console.error("Error clearing cache:", chrome.runtime.lastError);
        } else {
          setCsvCacheCleared(true);
          setTimeout(() => setCsvCacheCleared(false), 3000);
        }
      }
    );
  };

  const handleRefreshCsvLinks = async () => {
    setCsvRefreshing(true);

    chrome.storage.local.remove(
      ["csvLinksCache", "csvLinksCacheTimestamp"],
      async () => {
        if (chrome.runtime.lastError) {
          console.error("Error clearing cache:", chrome.runtime.lastError);
          setCsvRefreshing(false);
          return;
        }

        try {
          const { fetchCSVLinks } = await import("@/src/utils/csv-links");
          await fetchCSVLinks();
          setCsvCacheCleared(true);
          setTimeout(() => setCsvCacheCleared(false), 3000);
        } catch (error) {
          console.error("Error refreshing CSV links:", error);
        } finally {
          setCsvRefreshing(false);
        }
      }
    );
  };

  const handleDownloadDefaultCsv = async () => {
    setCsvDownloading(true);

    try {
      const defaultUrl =
        "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ8y5eHw3bj0MA0pyMS81o9AbAKrYQL_-a04P_hjoNrkYrrT9VyfsFZk8GE_RM_GRBKJG2J2r3OsZQj/pub?gid=808603945&single=true&output=csv";
      const response = await fetch(defaultUrl);

      if (!response.ok) {
        throw new Error("Failed to fetch default CSV");
      }

      const csvContent = await response.text();
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "volt-quicklinks-template.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      console.log("[Settings] Default CSV downloaded successfully");
    } catch (error) {
      console.error("[Settings] Error downloading default CSV:", error);
      chrome.notifications.create({
        type: "basic",
        iconUrl: "/assets/icons/logo-48.png",
        title: "Download Failed",
        message: "Failed to download CSV. Please try again.",
      });
    } finally {
      setCsvDownloading(false);
    }
  };

  return (
    <section id="csvlinks" className="scroll-mt-20">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">Quick Links</h2>
        <p className="text-muted-foreground">
          Configure custom CSV URL for Quick Links and manage cache
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
        <div className="divide-y divide-border">
          <div className="p-6">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-base">Custom CSV URL</h3>
                <button
                  onClick={handleDownloadDefaultCsv}
                  disabled={csvDownloading}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-muted text-foreground hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  <Download
                    className={`w-3.5 h-3.5 ${
                      csvDownloading ? "animate-pulse" : ""
                    }`}
                  />
                  {csvDownloading ? "Downloading..." : "Download Template"}
                </button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Enter a custom Google Sheets CSV URL to load your own Volt
                Links. Leave empty to use the default URL.
              </p>
              <input
                type="text"
                value={settings.csvLinks?.customUrl || ""}
                onChange={(event) => handleCsvUrlChange(event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/..."
                className="w-full px-4 py-2.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm font-mono"
              />
              <div className="flex items-start gap-2 mt-2">
                <p className="text-xs text-muted-foreground flex-1">
                  {"\u{1F4A1}"} Tip: Download the template to see the required
                  format (Category, Name, URL, Description). Upload to your own
                  Google Sheet, then use "File {"\u2192"} Share {"\u2192"}{" "}
                  Publish to web" and select CSV format.
                </p>
              </div>
            </div>

            {settings.csvLinks?.customUrl && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-700">
                  {"\u2713"} Using custom CSV URL. Clear the cache to reload
                  from your new URL.
                </p>
              </div>
            )}
          </div>

          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-2">
                  Cache Management
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Volt Links are cached for 30 minutes to improve performance.
                  Use these options to manage your CSV cache.
                </p>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    {"\u2022"} <strong>Refresh Now:</strong> Clears cache and
                    immediately fetches latest links
                  </p>
                  <p>
                    {"\u2022"} <strong>Clear Cache:</strong> Only clears cache
                    (fetches on next open)
                  </p>
                  <p>
                    {"\u2022"} Use after updating your Google Sheet or changing
                    CSV URL
                  </p>
                </div>
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs text-amber-700">
                    <strong>Note:</strong> Clearing CSV cache does NOT affect
                    your Chrome bookmarks. These are separate features.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleRefreshCsvLinks}
                  disabled={csvRefreshing}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-sm font-medium"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${
                      csvRefreshing ? "animate-spin" : ""
                    }`}
                  />
                  {csvRefreshing ? "Refreshing..." : "Refresh Now"}
                </button>
                <button
                  onClick={handleClearCsvCache}
                  className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground hover:bg-muted/80 rounded-lg transition-colors text-sm font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear Cache
                </button>
                {csvCacheCleared && (
                  <div className="flex items-center gap-2 px-3 py-1.5 text-green-700 bg-green-50 rounded-lg">
                    <Check className="w-4 h-4" />
                    <span className="text-xs font-medium">Done!</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
