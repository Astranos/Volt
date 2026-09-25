import { useEffect, useMemo, useState } from "react";
import { ClosedTabsPanel } from "../../src/components/newtab/ClosedTabsPanel";
import { QuickLinksColumn } from "../../src/components/newtab/QuickLinksColumn";
import { BookmarksColumn } from "../../src/components/newtab/BookmarksColumn";
import { HeroBlock } from "../../src/components/newtab/HeroBlock";
import type { SearchMode } from "../../src/components/newtab/NewTabHelp";
import { ExtensionAccountControl } from "../../src/components/access/ExtensionAccess";
import { Calculator, ClipboardCheck, ScanLine, Settings, Sparkles } from "lucide-react";
import { AppClipQrIcon } from "../../src/components/icons/AppClipQrIcon";
import { TabManager } from "../../src/utils/tab-manager";
import { getShopifyAuditConnection, openShopifyAudit } from "../../src/shopify-audit/client";
import { WhatsNewDialog } from "../../src/components/newtab/WhatsNewDialog";
import {
  NEW_TAB_SEARCH_PROVIDERS,
  parseSearchPrefix,
  resolveNewTabSearchIntent,
} from "../../src/domain/search-intent";
import "../../src/components/cmdk-palette/styles.css";
import "../../src/components/newtab/column-styles.css";
import "../../src/components/newtab/closed-tabs-panel.css";
import "../../src/components/newtab/newtab-layout.css";

export default function NewTab() {
  const [activeMode, setActiveMode] = useState<SearchMode>("closed-tabs");
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditNotice, setAuditNotice] = useState<string | null>(null);
  const [whatsNewRequest, setWhatsNewRequest] = useState(0);

  // Randomize the aurora blobs' starting offset + animation phase on every
  // new-tab load so the bg looks fresh each time.
  const auroraStyle = useMemo(() => {
    const rand = (min: number, max: number) =>
      Math.round(min + Math.random() * (max - min));
    return {
      "--blob1-x": `${rand(-200, 320)}px`,
      "--blob1-y": `${rand(-160, 220)}px`,
      "--blob1-delay": `${-rand(0, 22)}s`,
      "--blob2-x": `${rand(-320, 200)}px`,
      "--blob2-y": `${rand(-220, 160)}px`,
      "--blob2-delay": `${-rand(0, 28)}s`,
    } as React.CSSProperties;
  }, []);

  useEffect(() => {
    document.title = "Volt";
  }, []);

  const toggleSearchMode = (mode: SearchMode) => {
    setActiveMode((current) => {
      return current === mode ? "closed-tabs" : mode;
    });
  };

  const setSearchMode = (mode: SearchMode) => {
    setActiveMode(mode);
  };

  const handleSearchSubmit = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const prefixedSearch = parseSearchPrefix(trimmed);
    const effectiveMode = prefixedSearch.mode ?? activeMode;

    if (!prefixedSearch.query) return;

    if (prefixedSearch.mode && prefixedSearch.mode !== activeMode) {
      setSearchMode(prefixedSearch.mode);
    }
    if (effectiveMode === "shopify") return;
    const intent = resolveNewTabSearchIntent(trimmed, {
      activeMode,
      providers: NEW_TAB_SEARCH_PROVIDERS,
    });

    if (intent?.kind === "search-provider" || intent?.kind === "navigate") {
      await TabManager.updateCurrentTab(intent.url);
    }
  };

  const handleShopifyAudit = async () => {
    if (auditBusy) return;
    setAuditBusy(true);
    setAuditNotice(null);
    try {
      const connection = await getShopifyAuditConnection();
      if (!connection) {
        setAuditNotice("Connect your Shopify store in Volt settings first.");
        await chrome.tabs.create({ url: chrome.runtime.getURL("/options.html#shopify-audit"), active: true });
        return;
      }
      const result = await openShopifyAudit();
      setAuditNotice(result.count === 0
        ? `No products were created on ${result.date}.`
        : `Opened ${result.count} products from ${result.date} in a tab group.`);
    } catch (cause) {
      setAuditNotice(cause instanceof Error ? cause.message : "Could not open the Shopify audit.");
    } finally {
      setAuditBusy(false);
    }
  };

  return (
    <div className="newtab-root">
      {/* Decorative aurora background — pointer-events:none, sits behind everything */}
      <div
        className="newtab-aurora"
        aria-hidden="true"
        style={auroraStyle}
      >
        <span className="aurora-blob aurora-blob-1" />
        <span className="aurora-blob aurora-blob-2" />
      </div>

      <div className="newtab-container">
        {/* Compact header */}
        <header className="newtab-header">
          <div className="newtab-header-brand">
            <img
              src="/assets/icons/logo.png"
              alt=""
              className="newtab-header-logo"
            />
            <h1 className="newtab-header-title">Volt</h1>
          </div>
          <div className="newtab-header-actions">
            <button
              type="button"
              className="newtab-settings-button newtab-whats-new-trigger"
              onClick={() => setWhatsNewRequest((value) => value + 1)}
              aria-label="What’s new in Volt"
              title="What’s new in Volt"
            >
              <Sparkles aria-hidden="true" />
              <span>What’s new</span>
            </button>
            <button
              type="button"
              className="newtab-settings-button newtab-audit-button"
              onClick={() => void handleShopifyAudit()}
              disabled={auditBusy}
              aria-label="Audit Shopify products created yesterday"
              title="Open yesterday's Shopify products for review"
            >
              <ClipboardCheck aria-hidden="true" />
              <span>{auditBusy ? "Opening…" : "Audit"}</span>
            </button>
            <button
              type="button"
              className="newtab-settings-button"
              onClick={() =>
                void chrome.runtime.sendMessage({ action: "openInSidebar", tool: "top-offers", mode: "open" })
              }
              aria-label="Open Offer Calculator in sidepanel"
              title="Open Offer Calculator"
            >
              <Calculator />
            </button>
            <button
              type="button"
              className="newtab-settings-button"
              onClick={() =>
                void chrome.runtime.sendMessage({ action: "openInSidebar", tool: "mobile-scanner", mode: "open" })
              }
              aria-label="Open Scanner in sidepanel"
              title="Open Scanner"
            >
              <ScanLine />
            </button>
            <button
              type="button"
              className="newtab-settings-button"
              onClick={() =>
                void chrome.runtime.sendMessage({ action: "openMobileCapturePopup" })
              }
              aria-label="Open Volt App Clip QR code"
              title="Connect Volt App Clip"
            >
              <AppClipQrIcon />
            </button>
            <button
              type="button"
              className="newtab-settings-button"
              onClick={() => void chrome.runtime.sendMessage({ action: "open-settings" })}
              aria-label="Open Volt settings"
              title="Open Volt settings"
            >
              <Settings />
            </button>
            <ExtensionAccountControl surface="newtab" />
          </div>
        </header>

        {auditNotice && <p className="newtab-audit-notice" role="status">{auditNotice}</p>}

        {/* Hero: greeting + clock */}
        <HeroBlock />

        {/* Search */}
        <section className="newtab-search-section">
          <div
            id="tour-search-history"
            className="newtab-search-panel"
          >
            <ClosedTabsPanel
              onSearchSubmit={handleSearchSubmit}
              activeMode={activeMode}
              onToggleSearchMode={toggleSearchMode}
            />
          </div>

        </section>

        {/* Side columns: Quick Links & Bookmarks */}
        <section className="newtab-side-columns">
          <QuickLinksColumn id="tour-quick-links" />
          <BookmarksColumn id="tour-bookmarks" />
        </section>
      </div>
      <WhatsNewDialog openRequest={whatsNewRequest} />
    </div>
  );
}
