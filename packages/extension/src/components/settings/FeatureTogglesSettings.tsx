import type { SaveExtensionSettings } from "@/src/hooks/useExtensionSettings";
import type { CmdkSettings } from "@/src/types/settings";

const MOBILE_PHOTO_RETENTION_OPTIONS = [
  { value: 12, label: "12 hours" },
  { value: 24, label: "24 hours" },
  { value: 48, label: "48 hours" },
  { value: 72, label: "72 hours" },
];

interface FeatureTogglesSettingsProps {
  settings: CmdkSettings;
  saveSettings: SaveExtensionSettings;
}

export function FeatureTogglesSettings({
  settings,
  saveSettings,
}: FeatureTogglesSettingsProps) {
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
      />

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
      />

      <section id="mobilephotos" className="scroll-mt-20">
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Mobile Photos</h2>
          <p className="text-muted-foreground">
            Control automatic cleanup for photos downloaded from the mobile scanner.
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
          <div className="divide-y divide-border">
            <div className="p-6 flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-base">
                    Auto-delete downloaded photos
                  </h3>
                  {(settings.mobilePhotoDownloads?.autoDeleteEnabled ?? true) && (
                    <StatusBadge>Active</StatusBadge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                  Deletes Volt-created files in the Volt Photos download folder after the retention window. Cleanup runs at local midnight.
                </p>
              </div>
              <ToggleSwitch
                enabled={settings.mobilePhotoDownloads?.autoDeleteEnabled ?? true}
                onClick={() =>
                  void saveSettings({
                    ...settings,
                    mobilePhotoDownloads: {
                      ...settings.mobilePhotoDownloads,
                      autoDeleteEnabled: !(
                        settings.mobilePhotoDownloads?.autoDeleteEnabled ?? true
                      ),
                    },
                  })
                }
              />
            </div>

            <div className="p-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-base mb-1">Delete after</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Applies to future mobile photo downloads.
                </p>
              </div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-44"
                value={settings.mobilePhotoDownloads?.retentionHours ?? 24}
                disabled={settings.mobilePhotoDownloads?.autoDeleteEnabled === false}
                onChange={(event) =>
                  void saveSettings({
                    ...settings,
                    mobilePhotoDownloads: {
                      ...settings.mobilePhotoDownloads,
                      retentionHours: Number(event.target.value),
                    },
                  })
                }
              >
                {MOBILE_PHOTO_RETENTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>
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
}: {
  id: string;
  title: string;
  description: string;
  itemTitle: string;
  itemDescription: string;
  details?: string[];
  enabled: boolean;
  onToggle: () => void;
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
                {enabled && <StatusBadge>Active</StatusBadge>}
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
  children,
}: {
  children: string;
}) {
  return (
    <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700">
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
