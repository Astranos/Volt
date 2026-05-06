/* global chrome */
import { useState, useEffect } from "react";
import { Check, Menu } from "lucide-react";

interface CMDKSettings {
  enabledSources: {
    tabs: boolean;
    bookmarks: boolean;
    history: boolean;
    quickLinks: boolean;
    tools: boolean;
    searchProviders: boolean;
    ebayCategories: boolean;
  };
  sourceOrder: string[];
}

const DEFAULT_SETTINGS: CMDKSettings = {
  enabledSources: {
    tabs: true,
    bookmarks: true,
    history: true,
    quickLinks: true,
    tools: true,
    searchProviders: true,
    ebayCategories: true,
  },
  sourceOrder: [
    "tabs",
    "quickLinks",
    "ebayCategories",
    "bookmarks",
    "tools",
    "searchProviders",
    "history",
  ],
};

const ALL_SOURCE_KEYS = [...DEFAULT_SETTINGS.sourceOrder];

const mergeSettings = (stored?: Partial<CMDKSettings>): CMDKSettings => {
  if (!stored) {
    return DEFAULT_SETTINGS;
  }

  const mergedEnabledSources = {
    ...DEFAULT_SETTINGS.enabledSources,
    ...(stored.enabledSources || {}),
  };

  const sanitizedOrder = Array.isArray(stored.sourceOrder)
    ? stored.sourceOrder.filter((key) => ALL_SOURCE_KEYS.includes(key))
    : [];

  const mergedSourceOrder = [...sanitizedOrder];
  for (const key of ALL_SOURCE_KEYS) {
    if (!mergedSourceOrder.includes(key)) {
      mergedSourceOrder.push(key);
    }
  }

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    enabledSources: mergedEnabledSources,
    sourceOrder: mergedSourceOrder,
  };
};

export default function SettingsPopup() {
  const [settings, setSettings] = useState<CMDKSettings>(DEFAULT_SETTINGS);
  const [isSaved, setIsSaved] = useState(false);
  const [version, setVersion] = useState<string>("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

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
  }, []);

  const handleToggle = (source: keyof CMDKSettings["enabledSources"]) => {
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
    ebayCategories: {
      key: "ebayCategories" as const,
      label: "eBay Categories",
      description: "Live eBay category suggestions as you type",
    },
  };

  const sources = settings.sourceOrder
    .map((key) => sourcesConfig[key as keyof typeof sourcesConfig])
    .filter(Boolean);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="w-full px-8 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <img
            src="/assets/icons/dog.png"
            alt="PayMore"
            className="w-10 h-10 rounded-lg"
          />
          <div>
            <h1 className="text-2xl font-bold">
              Volt Settings
              {version && (
                <span className="text-sm text-muted-foreground ml-3">
                  v{version}
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure command menu sources and features
            </p>
          </div>
        </div>

        {/* Settings Card */}
        <div className="bg-card rounded-lg border border-border shadow-sm">
          <div className="p-6 border-b border-border">
            <h2 className="text-lg font-semibold mb-1">Command Menu</h2>
            <p className="text-sm text-muted-foreground">
              Enable or disable different sources in the command menu popup
            </p>
          </div>

          <div className="divide-y divide-border">
            {sources.map((source, index) => (
              <div
                key={source.key}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`p-4 flex items-start gap-4 hover:bg-muted/50 transition-colors cursor-move ${
                  draggedIndex === index ? "opacity-50" : ""
                }`}
              >
                <button
                  className="p-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <Menu className="w-4 h-4" />
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium">{source.label}</h3>
                    {settings.enabledSources[source.key] && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {source.description}
                  </p>
                </div>
                <button
                  onClick={() => handleToggle(source.key)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.enabledSources[source.key]
                      ? "bg-primary"
                      : "bg-muted-foreground/20"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
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

        {/* Action Buttons */}
        <div className="flex items-center gap-3 mt-6">
          {isSaved && (
            <div className="flex items-center gap-2 px-4 py-2 text-green-700 dark:text-green-400">
              <Check className="w-4 h-4" />
              <span className="text-sm font-medium">Saved!</span>
            </div>
          )}
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
          >
            Reset to Defaults
          </button>
        </div>

        {/* Info */}
        <div className="mt-6 p-4 bg-muted/50 rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">
            <strong>Tip:</strong> Drag the <Menu className="w-3 h-3 inline" />{" "}
            icon to reorder sources. The order you set here determines the order
            they appear in the command menu.
          </p>
        </div>
      </div>
    </div>
  );
}
