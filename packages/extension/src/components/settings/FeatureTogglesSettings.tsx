import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import { Menu } from "lucide-react";
import type { SaveExtensionSettings } from "@/src/hooks/useExtensionSettings";
import type { CmdkSettings } from "@/src/types/settings";

const SOURCES_CONFIG = {
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
    label: "Volt Links",
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

interface FeatureTogglesSettingsProps {
  settings: CmdkSettings;
  setSettings: Dispatch<SetStateAction<CmdkSettings>>;
  saveSettings: SaveExtensionSettings;
}

export function FeatureTogglesSettings({
  settings,
  setSettings,
  saveSettings,
}: FeatureTogglesSettingsProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const pendingSourceOrderSettingsRef = useRef<CmdkSettings | null>(null);
  const sources = settings.sourceOrder
    .map((key) => SOURCES_CONFIG[key as keyof typeof SOURCES_CONFIG])
    .filter(Boolean);

  const handleToggle = (source: keyof CmdkSettings["enabledSources"]) => {
    void saveSettings({
      ...settings,
      enabledSources: {
        ...settings.enabledSources,
        [source]: !settings.enabledSources[source],
      },
    });
  };

  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const currentSettings = pendingSourceOrderSettingsRef.current ?? settings;
    const newOrder = [...currentSettings.sourceOrder];
    const draggedItem = newOrder[draggedIndex];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedItem);

    const nextSettings = {
      ...currentSettings,
      sourceOrder: newOrder,
    };
    pendingSourceOrderSettingsRef.current = nextSettings;
    setSettings(nextSettings);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    const nextSettings = pendingSourceOrderSettingsRef.current ?? settings;
    pendingSourceOrderSettingsRef.current = null;
    void saveSettings(nextSettings);
  };

  return (
    <>
      <ToggleSection
        id="newtab"
        title="New Tab Override"
        description="Control whether Volt shows its custom new-tab experience."
        itemTitle="Use Volt New Tab"
        itemDescription="When enabled, new tabs open Volt's custom layout with closed tabs, quick links, and bookmarks. When disabled, Volt still owns the browser override, so new tabs redirect to Google instead of Chrome's built-in New Tab page."
        enabled={settings.newTabOverride?.enabled ?? true}
        onToggle={() =>
          void saveSettings({
            ...settings,
            newTabOverride: {
              ...settings.newTabOverride,
              enabled: !settings.newTabOverride?.enabled,
            },
          })
        }
        activeTone="green"
      />

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
                onDragStart={() => setDraggedIndex(index)}
                onDragOver={(event) => handleDragOver(event, index)}
                onDragEnd={handleDragEnd}
                className={`p-6 flex items-start gap-4 hover:bg-muted/30 transition-all cursor-move group ${
                  draggedIndex === index ? "opacity-50 scale-[0.98]" : ""
                }`}
              >
                <button
                  className="p-2 text-muted-foreground group-hover:text-foreground cursor-grab active:cursor-grabbing transition-colors"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className="font-semibold text-base">
                      {source.label}
                    </h3>
                    {settings.enabledSources[source.key] && (
                      <StatusBadge tone="green">Enabled</StatusBadge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {source.description}
                  </p>
                </div>
                <ToggleSwitch
                  enabled={settings.enabledSources[source.key]}
                  onClick={() => handleToggle(source.key)}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <ToggleSection
        id="shopify-buttons"
        title="Shopify Buttons"
        description="Enable or disable the quick action buttons on Shopify product pages"
        itemTitle="Enable Quick Action Buttons"
        itemDescription="Shows the floating toolbar with eBay and PriceCharting buttons on Shopify product pages."
        enabled={settings.shopifyButtons?.enabled ?? true}
        onToggle={() => {
          const newShopifyButtons = {
            ...settings.shopifyButtons,
            enabled: !settings.shopifyButtons?.enabled,
          };

          void saveSettings({
            ...settings,
            shopifyButtons: newShopifyButtons,
          }).then(() =>
            notifyTabs(
              "shopify-buttons-settings-changed",
              Boolean(newShopifyButtons.enabled)
            )
          );
        }}
        activeTone="green"
      />

      <ToggleSection
        id="ebay"
        title="Sold Listing Warning"
        description="Warn when eBay search pages are showing active or completed results instead of sold listings."
        itemTitle="Enable Sold Listing Warning"
        itemDescription="Shows an alert on eBay search results when pricing would be based on active asking prices or completed unsold listings, with a one-click switch to sold/completed listings."
        enabled={settings.soldListingWarning?.enabled ?? true}
        details={[
          "Warns when the current eBay results are not sold listings",
          "Explains why sold/completed listings are safer pricing comps",
          "One-click switch to sold/completed listings for price analysis",
          "Quick access to settings",
          "Dismissible per search session",
        ]}
        onToggle={() => {
          const newSoldListingWarning = {
            ...settings.soldListingWarning,
            enabled: !settings.soldListingWarning?.enabled,
          };

          void saveSettings({
            ...settings,
            soldListingWarning: newSoldListingWarning,
          }).then(() =>
            notifyTabs(
              "sold-listing-warning-settings-changed",
              Boolean(newSoldListingWarning.enabled)
            )
          );
        }}
        activeTone="blue"
      />

      <ToggleSection
        id="upc"
        title="UPC Highlighter"
        description="Automatically detect and highlight UPC codes on web pages"
        itemTitle="Enable UPC Detection"
        itemDescription="Automatically detects 12-digit UPC codes on web pages, highlights them with a special style, and makes them clickable to copy to clipboard."
        enabled={settings.upcHighlighter?.enabled ?? true}
        details={[
          "Automatically highlights 12-digit UPC codes",
          "Click any highlighted code to copy to clipboard",
          "Hover to see copy tooltip",
          "Works on all websites including dynamic content",
        ]}
        onToggle={() => {
          const newUpcHighlighter = {
            ...settings.upcHighlighter,
            enabled: !settings.upcHighlighter?.enabled,
          };

          void saveSettings({
            ...settings,
            upcHighlighter: newUpcHighlighter,
          }).then(() =>
            notifyTabs(
              "upc-highlighter-settings-changed",
              Boolean(newUpcHighlighter.enabled)
            )
          );
        }}
        activeTone="blue"
      />

      <ToggleSection
        id="contextmenu"
        title="Context Menu"
        description="Configure the right-click context menu behavior"
        itemTitle="Enable Context Menu"
        itemDescription="Shows a custom right-click menu with quick actions and search tools. The menu includes a dismiss button to temporarily disable it until page refresh."
        enabled={settings.contextMenu?.enabled ?? true}
        details={[
          "Quick actions: Copy, Paste, Open in New Tab, Save As",
          "Search tools: Google UPC, eBay Sold, UPCItemDB, PriceCharting",
          "Ctrl+Right-click to show native menu instead",
          "Click dismiss button to disable until page refresh",
        ]}
        onToggle={() => {
          const newContextMenu = {
            ...settings.contextMenu,
            enabled: !settings.contextMenu?.enabled,
          };

          void saveSettings({
            ...settings,
            contextMenu: newContextMenu,
          }).then(() =>
            notifyTabs(
              "context-menu-settings-changed",
              Boolean(newContextMenu.enabled)
            )
          );
        }}
        activeTone="blue"
      />
    </>
  );
}

function ToggleSection({
  id,
  title,
  description,
  itemTitle,
  itemDescription,
  details = [],
  enabled,
  onToggle,
  activeTone,
}: {
  id: string;
  title: string;
  description: string;
  itemTitle: string;
  itemDescription: string;
  details?: string[];
  enabled: boolean;
  onToggle: () => void;
  activeTone: "green" | "blue";
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
        <div className="divide-y divide-border">
          <div className="p-6 flex items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-base">{itemTitle}</h3>
                {enabled && <StatusBadge tone={activeTone}>Active</StatusBadge>}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                {itemDescription}
              </p>
              {details.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-1">
                  {details.map((detail) => (
                    <p key={detail}>{"\u2022"} {detail}</p>
                  ))}
                </div>
              )}
            </div>
            <ToggleSwitch enabled={enabled} onClick={onToggle} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ToggleSwitch({
  enabled,
  onClick,
}: {
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
        enabled ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function StatusBadge({
  tone,
  children,
}: {
  tone: "green" | "blue";
  children: string;
}) {
  const toneClasses =
    tone === "green"
      ? "bg-green-100 text-green-700"
      : "bg-blue-100 text-blue-700";

  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${toneClasses}`}>
      {children}
    </span>
  );
}

function notifyTabs(action: string, enabled: boolean) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs
          .sendMessage(tab.id, {
            action,
            enabled,
          })
          .catch(() => {
            // Ignore errors for tabs that don't have the content script.
          });
      }
    });
  });
}
