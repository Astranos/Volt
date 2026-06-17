/* global chrome */
import { useState, useEffect } from "react";
import {
  Check,
  Menu,
  X,
  Layers,
  Search as SearchIcon,
  Bookmark,
  Shield,
  TrendingUp,
  ScanLine,
  Barcode,
  Link2,
  Trash2,
  RefreshCw,
  Download,
  MousePointerClick,
  MapPin,
  Plus,
  Pencil,
} from "lucide-react";
import { getBookmarkFolders, BookmarkFolder } from "@/src/utils/bookmarks";
import type { CmdkSettings } from "@/src/types/settings";
import { DEFAULT_SETTINGS, mergeSettings } from "@/src/domain/settings";
import {
  addCustomTopOffer,
  addCustomTopOfferRule,
  addTopOfferRateRule,
  deleteCustomTopOffer,
  DEFAULT_CUSTOM_RATES,
  removeCustomTopOfferRule,
  removeTopOfferRateRule,
  sortCustomTopOfferRules,
  sortTopOfferRateRules,
  updateCustomTopOfferDefaultPercentage,
  updateCustomTopOfferName,
  updateCustomTopOfferRule,
  updateTopOfferCheckoutRate,
  updateTopOfferDefaultPercentage,
  updateTopOfferRateRule,
} from "@/src/domain/top-offers";

export default function SettingsPage() {
  const [settings, setSettings] = useState<CmdkSettings>(DEFAULT_SETTINGS);
  const [isSaved, setIsSaved] = useState(false);
  const [version, setVersion] = useState<string>("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({
    name: "",
    triggers: [] as string[],
    searchUrl: "",
    color: "bg-blue-500",
  });
  const [bookmarkFolders, setBookmarkFolders] = useState<BookmarkFolder[]>([]);
  const [csvCacheCleared, setCsvCacheCleared] = useState(false);
  const [csvRefreshing, setCsvRefreshing] = useState(false);
  const [csvDownloading, setCsvDownloading] = useState(false);
  const [editingCustomOffer, setEditingCustomOffer] = useState<string | null>(null);
  const [newCustomOfferName, setNewCustomOfferName] = useState("");

  useEffect(() => {
    // Load settings from chrome storage
    chrome.storage.sync.get(["cmdkSettings"], (result) => {
      if (result.cmdkSettings) {
        setSettings(mergeSettings(result.cmdkSettings));
      }
    });

    // Get extension version
    const manifest = chrome.runtime.getManifest();
    setVersion(manifest.version);

    // Load bookmark folders
    getBookmarkFolders().then(setBookmarkFolders);

    // Handle hash fragment for auto-scrolling to sections
    const handleHashChange = () => {
      const hash = window.location.hash.substring(1); // Remove the #
      if (hash) {
        // Small delay to ensure the page is fully rendered
        setTimeout(() => {
          const element = document.getElementById(hash);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);
      }
    };

    // Check for hash on initial load
    handleHashChange();

    // Listen for hash changes
    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const handleToggle = (source: keyof CmdkSettings["enabledSources"]) => {
    const newSettings = {
      ...settings,
      enabledSources: {
        ...settings.enabledSources,
        [source]: !settings.enabledSources[source],
      },
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);

    // Auto-save reset
    chrome.storage.sync.set({ cmdkSettings: DEFAULT_SETTINGS }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newOrder = [...settings.sourceOrder];
    const draggedItem = newOrder[draggedIndex];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedItem);

    const newSettings = {
      ...settings,
      sourceOrder: newOrder,
    };
    setSettings(newSettings);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: settings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleToggleSearchProvider = (providerId: string) => {
    const newSettings = {
      ...settings,
      enabledSearchProviders: {
        ...settings.enabledSearchProviders,
        [providerId]: !settings.enabledSearchProviders[providerId],
      },
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleAddCustomProvider = () => {
    if (
      !newProvider.name ||
      !newProvider.triggers.length ||
      !newProvider.searchUrl
    ) {
      return;
    }

    const id = newProvider.name.toLowerCase().replace(/\s+/g, "-");
    const customProvider = {
      id,
      name: newProvider.name,
      triggers: newProvider.triggers,
      searchUrl: newProvider.searchUrl,
      color: newProvider.color,
    };

    const newSettings = {
      ...settings,
      customSearchProviders: [
        ...settings.customSearchProviders,
        customProvider,
      ],
      enabledSearchProviders: {
        ...settings.enabledSearchProviders,
        [id]: true,
      },
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });

    // Reset form
    setNewProvider({
      name: "",
      triggers: [],
      searchUrl: "",
      color: "bg-blue-500",
    });
    setShowAddProvider(false);
  };

  const handleDeleteCustomProvider = (index: number) => {
    const providerToDelete = settings.customSearchProviders[index];
    const newCustomProviders = [...settings.customSearchProviders];
    newCustomProviders.splice(index, 1);

    const newEnabledProviders = { ...settings.enabledSearchProviders };
    delete newEnabledProviders[providerToDelete.id];

    const newSettings = {
      ...settings,
      customSearchProviders: newCustomProviders,
      enabledSearchProviders: newEnabledProviders,
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleToggleShopifyButtons = () => {
    const newShopifyButtons = {
      ...settings.shopifyButtons,
      enabled: !settings.shopifyButtons?.enabled,
    };

    const newSettings = {
      ...settings,
      shopifyButtons: newShopifyButtons,
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);

      // Notify content script of settings change
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, {
                action: "shopify-buttons-settings-changed",
                enabled: newShopifyButtons.enabled,
              })
              .catch(() => {
                // Ignore errors for tabs that don't have the content script
              });
          }
        });
      });
    });
  };

  const handleBookmarkFolderToggle = (folderId: string) => {
    const currentFolders = settings.bookmarkFolderIds || [];
    const newFolders = currentFolders.includes(folderId)
      ? currentFolders.filter((id) => id !== folderId)
      : [...currentFolders, folderId];

    const newSettings = {
      ...settings,
      bookmarkFolderIds: newFolders,
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleSelectAllFolders = () => {
    const newSettings = {
      ...settings,
      bookmarkFolderIds: [],
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleToggleEbaySummary = () => {
    const newEbaySummary = {
      ...settings.ebaySummary,
      enabled: !settings.ebaySummary?.enabled,
    };

    const newSettings = {
      ...settings,
      ebaySummary: newEbaySummary,
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);

      // Notify content script of settings change
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, {
                action: "ebay-summary-settings-changed",
                enabled: newEbaySummary.enabled,
              })
              .catch(() => {
                // Ignore errors for tabs that don't have the content script
              });
          }
        });
      });
    });
  };

  const handleToggleUpcHighlighter = () => {
    const newUpcHighlighter = {
      ...settings.upcHighlighter,
      enabled: !settings.upcHighlighter?.enabled,
    };

    const newSettings = {
      ...settings,
      upcHighlighter: newUpcHighlighter,
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);

      // Notify content script of settings change
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, {
                action: "upc-highlighter-settings-changed",
                enabled: newUpcHighlighter.enabled,
              })
              .catch(() => {
                // Ignore errors for tabs that don't have the content script
              });
          }
        });
      });
    });
  };

  const handleToggleContextMenu = () => {
    const newContextMenu = {
      ...settings.contextMenu,
      enabled: !settings.contextMenu?.enabled,
    };

    const newSettings = {
      ...settings,
      contextMenu: newContextMenu,
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);

      // Notify content script of settings change
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, {
                action: "context-menu-settings-changed",
                enabled: newContextMenu.enabled,
              })
              .catch(() => {
                // Ignore errors for tabs that don't have the content script
              });
          }
        });
      });
    });
  };

  const handleToggleNewTabOverride = () => {
    const newNewTabOverride = {
      ...settings.newTabOverride,
      enabled: !settings.newTabOverride?.enabled,
    };

    const newSettings = {
      ...settings,
      newTabOverride: newNewTabOverride,
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleUpdateRateRule = (
    type: "standard" | "premium",
    index: number,
    field: "threshold" | "percentage",
    value: number
  ) => {
    const newSettings = {
      ...settings,
      topOffers: updateTopOfferRateRule(settings.topOffers, type, index, field, value),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleSortRules = (type: "standard" | "premium") => {
    const newSettings = {
      ...settings,
      topOffers: sortTopOfferRateRules(settings.topOffers, type),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleAddRateRule = (type: "standard" | "premium") => {
    const newSettings = {
      ...settings,
      topOffers: addTopOfferRateRule(settings.topOffers, type),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleRemoveRateRule = (
    type: "standard" | "premium",
    index: number
  ) => {
    const newSettings = {
      ...settings,
      topOffers: removeTopOfferRateRule(settings.topOffers, type, index),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleUpdateDefaultPercentage = (
    type: "standard" | "premium",
    value: number
  ) => {
    const newSettings = {
      ...settings,
      topOffers: updateTopOfferDefaultPercentage(settings.topOffers, type, value),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleUpdateCheckoutRate = (value: number) => {
    const newSettings = {
      ...settings,
      topOffers: updateTopOfferCheckoutRate(settings.topOffers, value),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleAddCustomOffer = () => {
    const id = `custom-${Date.now()}`;
    const newSettings = {
      ...settings,
      topOffers: addCustomTopOffer(settings.topOffers, id),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });

    // Start editing the name
    setEditingCustomOffer(id);
    setNewCustomOfferName("Custom Offer");
  };

  const handleUpdateCustomOfferName = (offerId: string, name: string) => {
    const newSettings = {
      ...settings,
      topOffers: updateCustomTopOfferName(settings.topOffers, offerId, name),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });

    setEditingCustomOffer(null);
  };

  const handleDeleteCustomOffer = (offerId: string) => {
    const newSettings = {
      ...settings,
      topOffers: deleteCustomTopOffer(settings.topOffers, offerId),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleUpdateCustomOfferRule = (
    offerId: string,
    ruleIndex: number,
    field: "threshold" | "percentage",
    value: number
  ) => {
    const newSettings = {
      ...settings,
      topOffers: updateCustomTopOfferRule(settings.topOffers, offerId, ruleIndex, field, value),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleSortCustomOfferRules = (offerId: string) => {
    const newSettings = {
      ...settings,
      topOffers: sortCustomTopOfferRules(settings.topOffers, offerId),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleAddCustomOfferRule = (offerId: string) => {
    const newSettings = {
      ...settings,
      topOffers: addCustomTopOfferRule(settings.topOffers, offerId),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleRemoveCustomOfferRule = (offerId: string, ruleIndex: number) => {
    const newSettings = {
      ...settings,
      topOffers: removeCustomTopOfferRule(settings.topOffers, offerId, ruleIndex),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleUpdateCustomOfferDefaultPercentage = (
    offerId: string,
    value: number
  ) => {
    const newSettings = {
      ...settings,
      topOffers: updateCustomTopOfferDefaultPercentage(settings.topOffers, offerId, value),
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleCsvUrlChange = (url: string) => {
    const newCsvLinks = {
      ...settings.csvLinks,
      customUrl: url,
    };

    const newSettings = {
      ...settings,
      csvLinks: newCsvLinks,
    };
    setSettings(newSettings);

    // Auto-save
    chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    });
  };

  const handleClearCsvCache = () => {
    // Clear the CSV cache from chrome.storage.local
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

    // Clear cache first
    chrome.storage.local.remove(
      ["csvLinksCache", "csvLinksCacheTimestamp"],
      async () => {
        if (chrome.runtime.lastError) {
          console.error("Error clearing cache:", chrome.runtime.lastError);
          setCsvRefreshing(false);
          return;
        }

        // Import the fetchCSVLinks function dynamically and trigger a refresh
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
      // Default CSV URL
      const defaultUrl =
        "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ8y5eHw3bj0MA0pyMS81o9AbAKrYQL_-a04P_hjoNrkYrrT9VyfsFZk8GE_RM_GRBKJG2J2r3OsZQj/pub?gid=808603945&single=true&output=csv";

      // Fetch the CSV
      const response = await fetch(defaultUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch default CSV");
      }

      const csvContent = await response.text();

      // Create a blob and download it
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "scout-quicklinks-template.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      console.log("[Settings] Default CSV downloaded successfully");
    } catch (error) {
      console.error("[Settings] Error downloading default CSV:", error);
      chrome.notifications.create({
        type: "basic",
        iconUrl: "/assets/icons/icon-48.png",
        title: "Download Failed",
        message: "Failed to download CSV. Please try again.",
      });
    } finally {
      setCsvDownloading(false);
    }
  };

  const sourcesConfig = {
    tabs: {
      key: "tabs" as const,
      label: "Tabs",
      description: "Search and switch between open browser tabs",
    },
    bookmarks: {
      key: "bookmarks" as const,
      label: "Bookmarks",
      description: "Access your saved bookmarks",
    },
    history: {
      key: "history" as const,
      label: "Recent History",
      description: "View recently visited pages",
    },
    quickLinks: {
      key: "quickLinks" as const,
      label: "Scout Links",
      description: "CSV-based custom links organized by category",
    },
    tools: {
      key: "tools" as const,
      label: "Tools",
      description: "PayMore extension tools and features",
    },
    searchProviders: {
      key: "searchProviders" as const,
      label: "Search Providers",
      description: "Google, YouTube, Amazon, and other search engines",
    },
  };

  const sources = settings.sourceOrder
    .map((key) => sourcesConfig[key as keyof typeof sourcesConfig])
    .filter(Boolean);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 text-foreground">
      {/* Header Bar */}
      <div className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-16 items-center px-6">
          <div className="flex items-center gap-3">
            <img
              src="/assets/icons/volt.webp"
              alt="Volt"
              className="w-10 h-10"
            />
            <div>
              <h1 className="text-lg font-bold">Volt Settings</h1>
              {version && (
                <p className="text-xs text-muted-foreground">
                  Version {version}
                </p>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {isSaved && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-green-700 bg-green-50 rounded-lg">
                <Check className="w-4 h-4" />
                <span className="text-sm font-medium">Saved!</span>
              </div>
            )}
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors text-sm font-medium"
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex max-w-[1800px] mx-auto">
        {/* Sidebar Navigation */}
        <aside className="sticky top-16 h-[calc(100vh-4rem)] w-64 border-r border-border/40 bg-background/50 backdrop-blur p-6">
          <nav className="space-y-1">
            <a
              href="#newtab"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
            >
              <ScanLine className="w-4 h-4" />
              New Tab Override
            </a>
            <a
              href="#sources"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
            >
              <Layers className="w-4 h-4" />
              Command Menu
            </a>
            <a
              href="#bookmarks"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
            >
              <Bookmark className="w-4 h-4" />
              Bookmarks
            </a>
            <a
              href="#providers"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
            >
              <SearchIcon className="w-4 h-4" />
              Search Providers
            </a>
            <a
              href="#guardrails"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
            >
              <Shield className="w-4 h-4" />
              Shopify Guardrails
            </a>
            <a
              href="#ebay"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
            >
              <TrendingUp className="w-4 h-4" />
              eBay Summary
            </a>
            <a
              href="#upc"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
            >
              <Barcode className="w-4 h-4" />
              UPC Highlighter
            </a>
            <a
              href="#contextmenu"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
            >
              <MousePointerClick className="w-4 h-4" />
              Context Menu
            </a>
            <a
              href="#csvlinks"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
            >
              <Link2 className="w-4 h-4" />
              Quick Links
            </a>
            <a
              href="#topoffers"
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
            >
              <MapPin className="w-4 h-4" />
              Offers
            </a>
          </nav>

          <div className="mt-8 p-4 bg-muted/30 rounded-lg border border-border/40">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground block mb-2">Quick Tip</strong>
              Drag the <Menu className="w-3 h-3 inline" /> icon to reorder
              sources. Changes are saved automatically.
            </p>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 p-8 space-y-12 max-w-5xl">
          {/* New Tab Override Section */}
          <section id="newtab" className="scroll-mt-20">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">New Tab Override</h2>
              <p className="text-muted-foreground">
                Control whether Volt shows its custom new-tab experience.
              </p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              <div className="divide-y divide-border">
                <div className="p-6 flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-base">
                        Use Volt New Tab
                      </h3>
                      {(settings.newTabOverride?.enabled ?? true) && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      When enabled, new tabs open Volt&apos;s custom layout with
                      closed tabs, quick links, and bookmarks. When disabled,
                      Volt still owns the browser override, so new tabs
                      redirect to Google instead of Chrome&apos;s built-in New
                      Tab page.
                    </p>
                  </div>
                  <button
                    onClick={handleToggleNewTabOverride}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                      settings.newTabOverride?.enabled ?? true
                        ? "bg-primary"
                        : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                        settings.newTabOverride?.enabled ?? true
                          ? "translate-x-6"
                          : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Command Sources Section */}
          <section id="sources" className="scroll-mt-20">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">Command Menu Sources</h2>
              <p className="text-muted-foreground">
                Control which sources appear in your command menu and customize
                their order
              </p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              <div className="divide-y divide-border">
                {sources.map((source, index) => (
                  <div
                    key={source.key}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`p-6 flex items-start gap-4 hover:bg-muted/30 transition-all cursor-move group ${
                      draggedIndex === index ? "opacity-50 scale-[0.98]" : ""
                    }`}
                  >
                    <button
                      className="p-2 text-muted-foreground group-hover:text-foreground cursor-grab active:cursor-grabbing transition-colors"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <Menu className="w-5 h-5" />
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <h3 className="font-semibold text-base">
                          {source.label}
                        </h3>
                        {settings.enabledSources[source.key] && (
                          <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium">
                            Enabled
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {source.description}
                      </p>
                    </div>
                    <button
                      onClick={() => handleToggle(source.key)}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                        settings.enabledSources[source.key]
                          ? "bg-primary"
                          : "bg-muted-foreground/30"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                          settings.enabledSources[source.key]
                            ? "translate-x-6"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Bookmarks Section */}
          <section id="bookmarks" className="scroll-mt-20">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">Bookmarks</h2>
              <p className="text-muted-foreground">
                Choose which bookmark folders to display in the command menu
              </p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              <div className="p-8">
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-sm font-medium">
                      Bookmark Folders
                    </label>
                    <button
                      onClick={handleSelectAllFolders}
                      className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      {settings.bookmarkFolderIds?.length === 0
                        ? "Selected: All"
                        : "Select All"}
                    </button>
                  </div>

                  {settings.bookmarkFolderIds?.length === 0 && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm text-green-700">
                        All bookmarks from all folders are currently shown
                      </p>
                    </div>
                  )}

                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {bookmarkFolders.map((folder) => {
                      const isSelected =
                        settings.bookmarkFolderIds?.includes(folder.id) ??
                        false;
                      return (
                        <div
                          key={folder.id}
                          onClick={() => handleBookmarkFolderToggle(folder.id)}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                            isSelected
                              ? "bg-primary/10 border-primary hover:bg-primary/15"
                              : "bg-muted/30 border-border hover:bg-muted/50"
                          }`}
                        >
                          <div
                            className={`flex items-center justify-center w-5 h-5 rounded border-2 transition-colors ${
                              isSelected
                                ? "bg-primary border-primary"
                                : "bg-background border-muted-foreground/30"
                            }`}
                          >
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-primary-foreground" />
                            )}
                          </div>
                          <span className="text-sm font-medium flex-1">
                            {folder.title}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-xs text-muted-foreground mt-4">
                    Select specific folders to show only bookmarks from those
                    folders, or click "Select All" to show bookmarks from all
                    folders
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Search Providers Section */}
          <section id="providers" className="scroll-mt-20">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">Search Providers</h2>
              <p className="text-muted-foreground">
                Configure built-in search engines and create custom search
                providers
              </p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              <div className="divide-y divide-border">
                {/* Default Search Providers */}
                <div className="p-8">
                  <h3 className="font-semibold text-lg mb-5">
                    Default Providers
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[
                      { id: "google", name: "Google" },
                      { id: "scout", name: "Scout Search" },
                      { id: "amazon", name: "Amazon" },
                      { id: "bestbuy", name: "Best Buy" },
                      { id: "ebay", name: "eBay" },
                      { id: "pricecharting", name: "Price Charting" },
                      { id: "upcitemdb", name: "UPCItemDB" },
                      { id: "youtube", name: "YouTube" },
                      { id: "github", name: "GitHub" },
                      { id: "twitter", name: "Twitter/X" },
                      { id: "homedepot", name: "Home Depot" },
                      { id: "lowes", name: "Lowe's" },
                      { id: "menards", name: "Menards" },
                      { id: "microcenter", name: "Micro Center" },
                    ].map((provider) => (
                      <div
                        key={provider.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <span className="text-sm font-medium">
                          {provider.name}
                        </span>
                        <button
                          onClick={() =>
                            handleToggleSearchProvider(provider.id)
                          }
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            settings.enabledSearchProviders[provider.id] ||
                            settings.enabledSearchProviders[provider.id] ===
                              undefined
                              ? "bg-primary"
                              : "bg-muted-foreground/30"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                              settings.enabledSearchProviders[provider.id] ||
                              settings.enabledSearchProviders[provider.id] ===
                                undefined
                                ? "translate-x-6"
                                : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Custom Search Providers */}
                <div className="p-8">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="font-semibold text-lg">Custom Providers</h3>
                    <button
                      onClick={() => setShowAddProvider(!showAddProvider)}
                      className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      Add Provider
                    </button>
                  </div>

                  {settings.customSearchProviders.length > 0 ? (
                    <div className="space-y-3">
                      {settings.customSearchProviders.map((provider, index) => (
                        <div
                          key={provider.id}
                          className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="font-semibold text-sm mb-1">
                              {provider.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Triggers: {provider.triggers.join(", ")}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() =>
                                handleToggleSearchProvider(provider.id)
                              }
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                settings.enabledSearchProviders[provider.id] ||
                                settings.enabledSearchProviders[provider.id] ===
                                  undefined
                                  ? "bg-primary"
                                  : "bg-muted-foreground/30"
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                                  settings.enabledSearchProviders[
                                    provider.id
                                  ] ||
                                  settings.enabledSearchProviders[
                                    provider.id
                                  ] === undefined
                                    ? "translate-x-6"
                                    : "translate-x-1"
                                }`}
                              />
                            </button>
                            <button
                              onClick={() => handleDeleteCustomProvider(index)}
                              className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 px-4 bg-muted/20 rounded-lg border border-dashed border-border">
                      <p className="text-sm text-muted-foreground">
                        No custom providers added yet. Click "Add Provider" to
                        create one.
                      </p>
                    </div>
                  )}

                  {showAddProvider && (
                    <div className="mt-6 p-6 border border-border rounded-xl bg-muted/20">
                      <h4 className="font-semibold text-base mb-4">
                        Add Custom Search Provider
                      </h4>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            Name
                          </label>
                          <input
                            type="text"
                            value={newProvider.name}
                            onChange={(e) =>
                              setNewProvider({
                                ...newProvider,
                                name: e.target.value,
                              })
                            }
                            className="w-full px-4 py-2.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                            placeholder="e.g., Wikipedia"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            Triggers (comma-separated)
                          </label>
                          <input
                            type="text"
                            value={newProvider.triggers.join(", ")}
                            onChange={(e) =>
                              setNewProvider({
                                ...newProvider,
                                triggers: e.target.value
                                  .split(",")
                                  .map((t) => t.trim())
                                  .filter((t) => t),
                              })
                            }
                            className="w-full px-4 py-2.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                            placeholder="e.g., wiki, w"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            Search URL
                          </label>
                          <input
                            type="text"
                            value={newProvider.searchUrl}
                            onChange={(e) =>
                              setNewProvider({
                                ...newProvider,
                                searchUrl: e.target.value,
                              })
                            }
                            className="w-full px-4 py-2.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                            placeholder="e.g., https://en.wikipedia.org/wiki/Special:Search?search={query}"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Use {"{query}"} as a placeholder for the search term
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            Color
                          </label>
                          <select
                            value={newProvider.color}
                            onChange={(e) =>
                              setNewProvider({
                                ...newProvider,
                                color: e.target.value,
                              })
                            }
                            className="w-full px-4 py-2.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                          >
                            <option value="bg-blue-500">Blue</option>
                            <option value="bg-green-500">Green</option>
                            <option value="bg-red-500">Red</option>
                            <option value="bg-yellow-500">Yellow</option>
                            <option value="bg-purple-500">Purple</option>
                            <option value="bg-pink-500">Pink</option>
                            <option value="bg-indigo-500">Indigo</option>
                            <option value="bg-gray-500">Gray</option>
                          </select>
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={handleAddCustomProvider}
                            disabled={
                              !newProvider.name ||
                              !newProvider.triggers.length ||
                              !newProvider.searchUrl
                            }
                            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors shadow-sm"
                          >
                            Add Provider
                          </button>
                          <button
                            onClick={() => {
                              setShowAddProvider(false);
                              setNewProvider({
                                name: "",
                                triggers: [],
                                searchUrl: "",
                                color: "bg-blue-500",
                              });
                            }}
                            className="px-5 py-2.5 bg-muted text-foreground rounded-lg hover:bg-muted/80 font-medium transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Shopify Buttons Section */}
          <section id="shopify-buttons" className="scroll-mt-20">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">Shopify Buttons</h2>
              <p className="text-muted-foreground">
                Enable or disable the quick action buttons on Shopify product
                pages
              </p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              <div className="divide-y divide-border">
                {/* Enable Buttons Toggle */}
                <div className="p-6 flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-base">
                        Enable Quick Action Buttons
                      </h3>
                      {settings.shopifyButtons?.enabled && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Shows the floating toolbar with eBay and PriceCharting
                      buttons on Shopify product pages.
                    </p>
                  </div>
                  <button
                    onClick={handleToggleShopifyButtons}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                      settings.shopifyButtons?.enabled ?? true
                        ? "bg-primary"
                        : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                        settings.shopifyButtons?.enabled ?? true
                          ? "translate-x-6"
                          : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* eBay Price Summary Section */}
          <section id="ebay" className="scroll-mt-20">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">eBay Summary</h2>
              <p className="text-muted-foreground">
                Display search context summary on eBay search pages
              </p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              <div className="divide-y divide-border">
                {/* Enable/Disable Toggle */}
                <div className="p-6 flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-base">
                        Enable eBay Summary
                      </h3>
                      {settings.ebaySummary?.enabled && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                      Displays a summary banner showing your current search
                      context (Active vs Sold listings, item condition) at the
                      top of eBay search results. Includes quick filter links.
                    </p>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>
                        • Shows current listing type (Active/Sold/Completed) and
                        condition filters
                      </p>
                      <p>
                        • Quick filter links to switch between New, Used, and
                        Broken conditions
                      </p>
                      <p>
                        • One-click switch to Sold Listings for price analysis
                      </p>
                      <p>• Access to eBay Tool sidepanel and settings</p>
                      <p>• Dismissible per search session</p>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleEbaySummary}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                      settings.ebaySummary?.enabled ?? true
                        ? "bg-primary"
                        : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                        settings.ebaySummary?.enabled ?? true
                          ? "translate-x-6"
                          : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* UPC Highlighter Section */}
          <section id="upc" className="scroll-mt-20">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">UPC Highlighter</h2>
              <p className="text-muted-foreground">
                Automatically detect and highlight UPC codes on web pages
              </p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              <div className="divide-y divide-border">
                {/* Enable/Disable Toggle */}
                <div className="p-6 flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-base">
                        Enable UPC Detection
                      </h3>
                      {settings.upcHighlighter?.enabled && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                      Automatically detects 12-digit UPC codes on web pages,
                      highlights them with a special style, and makes them
                      clickable to copy to clipboard.
                    </p>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>• Automatically highlights 12-digit UPC codes</p>
                      <p>• Click any highlighted code to copy to clipboard</p>
                      <p>• Hover to see copy tooltip</p>
                      <p>• Works on all websites including dynamic content</p>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleUpcHighlighter}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                      settings.upcHighlighter?.enabled ?? true
                        ? "bg-primary"
                        : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                        settings.upcHighlighter?.enabled ?? true
                          ? "translate-x-6"
                          : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Context Menu Section */}
          <section id="contextmenu" className="scroll-mt-20">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">Context Menu</h2>
              <p className="text-muted-foreground">
                Configure the right-click context menu behavior
              </p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              <div className="divide-y divide-border">
                {/* Enable/Disable Toggle */}
                <div className="p-6 flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-base">
                        Enable Context Menu
                      </h3>
                      {settings.contextMenu?.enabled && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                      Shows a custom right-click menu with quick actions and
                      search tools. The menu includes a dismiss button to
                      temporarily disable it until page refresh.
                    </p>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>
                        • Quick actions: Copy, Paste, Open in New Tab, Save As
                      </p>
                      <p>
                        • Search tools: Google UPC, eBay Sold, UPCItemDB,
                        PriceCharting
                      </p>
                      <p>• Ctrl+Right-click to show native menu instead</p>
                      <p>
                        • Click dismiss button to disable until page refresh
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleContextMenu}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                      settings.contextMenu?.enabled ?? true
                        ? "bg-primary"
                        : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                        settings.contextMenu?.enabled ?? true
                          ? "translate-x-6"
                          : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* CSV Scout Links Section */}
          <section id="csvlinks" className="scroll-mt-20">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2">Quick Links</h2>
              <p className="text-muted-foreground">
                Configure custom CSV URL for Quick Links and manage cache
              </p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              <div className="divide-y divide-border">
                {/* Custom CSV URL */}
                <div className="p-6">
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-base">
                        Custom CSV URL
                      </h3>
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
                        {csvDownloading
                          ? "Downloading..."
                          : "Download Template"}
                      </button>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Enter a custom Google Sheets CSV URL to load your own
                      Scout Links. Leave empty to use the default URL.
                    </p>
                    <input
                      type="text"
                      value={settings.csvLinks?.customUrl || ""}
                      onChange={(e) => handleCsvUrlChange(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/..."
                      className="w-full px-4 py-2.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm font-mono"
                    />
                    <div className="flex items-start gap-2 mt-2">
                      <p className="text-xs text-muted-foreground flex-1">
                        💡 Tip: Download the template to see the required format
                        (Category, Name, URL, Description). Upload to your own
                        Google Sheet, then use "File → Share → Publish to web"
                        and select CSV format.
                      </p>
                    </div>
                  </div>

                  {settings.csvLinks?.customUrl && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs text-blue-700">
                        ✓ Using custom CSV URL. Clear the cache to reload from
                        your new URL.
                      </p>
                    </div>
                  )}
                </div>

                {/* Cache Management */}
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-semibold text-base mb-2">
                        Cache Management
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Scout Links are cached for 30 minutes to improve
                        performance. Use these options to manage your CSV cache.
                      </p>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>
                          • <strong>Refresh Now:</strong> Clears cache and
                          immediately fetches latest links
                        </p>
                        <p>
                          • <strong>Clear Cache:</strong> Only clears cache
                          (fetches on next open)
                        </p>
                        <p>
                          • Use after updating your Google Sheet or changing CSV
                          URL
                        </p>
                      </div>
                      <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-xs text-amber-700">
                          <strong>Note:</strong> Clearing CSV cache does NOT
                          affect your Chrome bookmarks. These are separate
                          features.
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

          {/* Offers Section */}
          <section id="topoffers" className="scroll-mt-20">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-2">Offers</h2>
                <p className="text-muted-foreground">
                  Configure settings for the Offer Calculator
                </p>
              </div>
              <button
                onClick={() => {
                  const newSettings = {
                    ...settings,
                    topOffers: {
                      ...settings.topOffers,
                      customRates: DEFAULT_CUSTOM_RATES,
                    },
                  };
                  setSettings(newSettings);

                  // Auto-save
                  chrome.storage.sync.set({ cmdkSettings: newSettings }, () => {
                    setIsSaved(true);
                    setTimeout(() => setIsSaved(false), 2000);
                  });
                }}
                className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground hover:bg-muted/80 rounded-lg transition-colors text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                Reset Rates
              </button>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
              <div className="p-8 space-y-8">
                {/* Standard Rates Editor */}
                <div>
                  <h3 className="font-semibold text-lg mb-4">Standard Rates</h3>
                  <div className="space-y-3">
                    <div className="grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground px-2">
                      <div className="col-span-5">Under Amount ($)</div>
                      <div className="col-span-5">Percentage (0.1 = 10%)</div>
                      <div className="col-span-2"></div>
                    </div>
                    {(
                      settings.topOffers?.customRates?.standard.rules ||
                      DEFAULT_SETTINGS.topOffers!.customRates!.standard.rules
                    ).map((rule, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-12 gap-4 items-center"
                      >
                        <div className="col-span-5">
                          <input
                            type="number"
                            value={rule.threshold}
                            onChange={(e) =>
                              handleUpdateRateRule(
                                "standard",
                                index,
                                "threshold",
                                parseFloat(e.target.value)
                              )
                            }
                            onBlur={() => handleSortRules("standard")}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                          />
                        </div>
                        <div className="col-span-5">
                          <input
                            type="number"
                            step="0.01"
                            value={rule.percentage}
                            onChange={(e) =>
                              handleUpdateRateRule(
                                "standard",
                                index,
                                "percentage",
                                parseFloat(e.target.value)
                              )
                            }
                            className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                          />
                        </div>
                        <div className="col-span-2 flex justify-end">
                          <button
                            onClick={() =>
                              handleRemoveRateRule("standard", index)
                            }
                            className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-12 gap-4 items-center pt-2">
                      <div className="col-span-5 text-sm font-medium pl-2">
                        Everything else
                      </div>
                      <div className="col-span-5">
                        <input
                          type="number"
                          step="0.01"
                          value={
                            settings.topOffers?.customRates?.standard
                              .defaultPercentage ?? 0.65
                          }
                          onChange={(e) =>
                            handleUpdateDefaultPercentage(
                              "standard",
                              parseFloat(e.target.value)
                            )
                          }
                          className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                        />
                      </div>
                      <div className="col-span-2"></div>
                    </div>
                    <div className="pt-2">
                      <button
                        onClick={() => handleAddRateRule("standard")}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Add Rule
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border" />

                {/* Premium Rates Editor */}
                <div>
                  <h3 className="font-semibold text-lg mb-4">Premium Rates</h3>
                  <div className="space-y-3">
                    <div className="grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground px-2">
                      <div className="col-span-5">Under Amount ($)</div>
                      <div className="col-span-5">Percentage (0.1 = 10%)</div>
                      <div className="col-span-2"></div>
                    </div>
                    {(
                      settings.topOffers?.customRates?.premium.rules ||
                      DEFAULT_SETTINGS.topOffers!.customRates!.premium.rules
                    ).map((rule, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-12 gap-4 items-center"
                      >
                        <div className="col-span-5">
                          <input
                            type="number"
                            value={rule.threshold}
                            onChange={(e) =>
                              handleUpdateRateRule(
                                "premium",
                                index,
                                "threshold",
                                parseFloat(e.target.value)
                              )
                            }
                            onBlur={() => handleSortRules("premium")}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                          />
                        </div>
                        <div className="col-span-5">
                          <input
                            type="number"
                            step="0.01"
                            value={rule.percentage}
                            onChange={(e) =>
                              handleUpdateRateRule(
                                "premium",
                                index,
                                "percentage",
                                parseFloat(e.target.value)
                              )
                            }
                            className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                          />
                        </div>
                        <div className="col-span-2 flex justify-end">
                          <button
                            onClick={() =>
                              handleRemoveRateRule("premium", index)
                            }
                            className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-12 gap-4 items-center pt-2">
                      <div className="col-span-5 text-sm font-medium pl-2">
                        Everything else
                      </div>
                      <div className="col-span-5">
                        <input
                          type="number"
                          step="0.01"
                          value={
                            settings.topOffers?.customRates?.premium
                              .defaultPercentage ?? 0.75
                          }
                          onChange={(e) =>
                            handleUpdateDefaultPercentage(
                              "premium",
                              parseFloat(e.target.value)
                            )
                          }
                          className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                        />
                      </div>
                      <div className="col-span-2"></div>
                    </div>
                    <div className="pt-2">
                      <button
                        onClick={() => handleAddRateRule("premium")}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Add Rule
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border" />

                {/* Checkout Rate Editor */}
                <div>
                  <h3 className="font-semibold text-lg mb-4">Checkout Rate</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Set the percentage used for the "Checkout Offer" top calculation. The starting value uses the standard top-offer guide.
                  </p>
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-5 text-sm font-medium pl-2">
                      All amounts
                    </div>
                    <div className="col-span-5">
                      <input
                        type="number"
                        step="0.01"
                        value={
                          settings.topOffers?.customRates?.checkout
                            ?.percentage ?? DEFAULT_CUSTOM_RATES.checkout!.percentage
                        }
                        onChange={(e) =>
                          handleUpdateCheckoutRate(parseFloat(e.target.value))
                        }
                        className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                      />
                    </div>
                    <div className="col-span-2"></div>
                  </div>
                </div>

                <div className="border-t border-border" />

                {/* Custom Offers Section */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-lg">Custom Offers</h3>
                      <p className="text-sm text-muted-foreground">
                        Create custom offer calculations with your own rates
                      </p>
                    </div>
                    <button
                      onClick={handleAddCustomOffer}
                      className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors text-sm font-medium"
                    >
                      <Plus className="w-4 h-4" />
                      Add Custom Offer
                    </button>
                  </div>

                  {settings.topOffers?.customOffers &&
                  settings.topOffers.customOffers.length > 0 ? (
                    <div className="space-y-6">
                      {settings.topOffers.customOffers.map((offer) => (
                        <div
                          key={offer.id}
                          className="p-4 border border-border rounded-lg bg-muted/20"
                        >
                          {/* Custom Offer Header */}
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              {editingCustomOffer === offer.id ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={newCustomOfferName}
                                    onChange={(e) =>
                                      setNewCustomOfferName(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        handleUpdateCustomOfferName(
                                          offer.id,
                                          newCustomOfferName
                                        );
                                      }
                                      if (e.key === "Escape") {
                                        setEditingCustomOffer(null);
                                      }
                                    }}
                                    className="px-3 py-1.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-base font-semibold"
                                    autoFocus
                                  />
                                  <button
                                    onClick={() =>
                                      handleUpdateCustomOfferName(
                                        offer.id,
                                        newCustomOfferName
                                      )
                                    }
                                    className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setEditingCustomOffer(null)}
                                    className="p-1.5 text-muted-foreground hover:bg-muted rounded-lg transition-colors"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <h4 className="font-semibold text-base">
                                    {offer.name}
                                  </h4>
                                  <button
                                    onClick={() => {
                                      setEditingCustomOffer(offer.id);
                                      setNewCustomOfferName(offer.name);
                                    }}
                                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                            <button
                              onClick={() => handleDeleteCustomOffer(offer.id)}
                              className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Custom Offer Rules */}
                          <div className="space-y-3">
                            <div className="grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground px-2">
                              <div className="col-span-5">Under Amount ($)</div>
                              <div className="col-span-5">
                                Percentage (0.1 = 10%)
                              </div>
                              <div className="col-span-2"></div>
                            </div>
                            {offer.rules.map((rule, ruleIndex) => (
                              <div
                                key={ruleIndex}
                                className="grid grid-cols-12 gap-4 items-center"
                              >
                                <div className="col-span-5">
                                  <input
                                    type="number"
                                    value={rule.threshold}
                                    onChange={(e) =>
                                      handleUpdateCustomOfferRule(
                                        offer.id,
                                        ruleIndex,
                                        "threshold",
                                        parseFloat(e.target.value)
                                      )
                                    }
                                    onBlur={() =>
                                      handleSortCustomOfferRules(offer.id)
                                    }
                                    className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                                  />
                                </div>
                                <div className="col-span-5">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={rule.percentage}
                                    onChange={(e) =>
                                      handleUpdateCustomOfferRule(
                                        offer.id,
                                        ruleIndex,
                                        "percentage",
                                        parseFloat(e.target.value)
                                      )
                                    }
                                    className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                                  />
                                </div>
                                <div className="col-span-2 flex justify-end">
                                  <button
                                    onClick={() =>
                                      handleRemoveCustomOfferRule(
                                        offer.id,
                                        ruleIndex
                                      )
                                    }
                                    className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                            <div className="grid grid-cols-12 gap-4 items-center pt-2">
                              <div className="col-span-5 text-sm font-medium pl-2">
                                Everything else
                              </div>
                              <div className="col-span-5">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={offer.defaultPercentage}
                                  onChange={(e) =>
                                    handleUpdateCustomOfferDefaultPercentage(
                                      offer.id,
                                      parseFloat(e.target.value)
                                    )
                                  }
                                  className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                                />
                              </div>
                              <div className="col-span-2"></div>
                            </div>
                            <div className="pt-2">
                              <button
                                onClick={() =>
                                  handleAddCustomOfferRule(offer.id)
                                }
                                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
                              >
                                <Plus className="w-4 h-4" />
                                Add Rule
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 px-4 bg-muted/20 rounded-lg border border-dashed border-border">
                      <p className="text-sm text-muted-foreground">
                        No custom offers added yet. Click "Add Custom Offer" to
                        create one with your own rates.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
