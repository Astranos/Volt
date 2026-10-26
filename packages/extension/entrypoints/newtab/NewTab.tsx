import { useEffect, useMemo, useRef, useState } from "react";
import { ClosedTabsPanel } from "../../src/components/newtab/ClosedTabsPanel";
import { QuickLinksColumn } from "../../src/components/newtab/QuickLinksColumn";
import { BookmarksColumn } from "../../src/components/newtab/BookmarksColumn";
import { HeroBlock } from "../../src/components/newtab/HeroBlock";
import type { SearchMode } from "../../src/components/newtab/NewTabHelp";
import { ExtensionAccountControl } from "../../src/components/access/ExtensionAccess";
import { BookOpen, Calculator, ClipboardCheck, ScanLine, Settings } from "lucide-react";
import { AppClipQrIcon } from "../../src/components/icons/AppClipQrIcon";
import { TabManager } from "../../src/utils/tab-manager";
import { getShopifyAuditConnection, openShopifyAudit } from "../../src/shopify-audit/client";
import { useShopifyAuditMode } from "../../src/shopify-audit/use-audit-mode";
import { SHOPIFY_AUDIT_REVIEW_REQUEST_KEY, type ShopifyAuditReviewRequest } from "../../src/domain/shopify-audit";
import { UpdateReadyButton } from "../../src/components/newtab/UpdateReadyButton";
import { WhatsNewDialog, useWhatsNew } from "../../src/components/newtab/WhatsNewDialog";
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
  const [activeMode, setActiveMode] = useState<SearchMode>("shopify");
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditNotice, setAuditNotice] = useState<string | null>(null);
  const [auditMode] = useShopifyAuditMode();
  // Read up front: the side panel must open inside the click's user gesture,
  // before anything is awaited.
  const currentTab = useRef<{ id: number | null; windowId: number | null }>({ id: null, windowId: null });
  useEffect(() => {
    void chrome.tabs?.getCurrent().then((tab) => {
      currentTab.current = { id: tab?.id ?? null, windowId: tab?.windowId ?? null };
    }).catch(() => undefined);
  }, []);
  const whatsNew = useWhatsNew();

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

  // Height that reaches the bottom of the viewport, used when Shopify results
  // expand the panel. offsetTop ignores the panel's entrance transform.
  const searchPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fit = () => {
      const panel = searchPanelRef.current;
      if (!panel) return;
      let top = 0;
      for (let el: HTMLElement | null = panel; el; el = el.offsetParent as HTMLElement | null) top += el.offsetTop;
      panel.style.setProperty("--nt-search-fill-height", `${window.innerHeight - top - 24}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    // Late content above the panel (notices, fonts) moves it down.
    const observer = new ResizeObserver(fit);
    const container = searchPanelRef.current?.closest(".newtab-container");
    if (container) observer.observe(container);
    return () => {
      window.removeEventListener("resize", fit);
      observer.disconnect();
    };
  }, []);


  const handleSearchSubmit = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const prefixedSearch = parseSearchPrefix(trimmed);
    const effectiveMode = prefixedSearch.mode ?? activeMode;

    if (!prefixedSearch.query) return;

    if (prefixedSearch.mode && prefixedSearch.mode !== activeMode) {
      setActiveMode(prefixedSearch.mode);
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

  const openAuditSidePanel = () => {
    const { id, windowId } = currentTab.current;
    setAuditNotice(null);
    const request: ShopifyAuditReviewRequest = { at: Date.now(), tabId: id };
    void chrome.storage.local.set({ sidePanelTool: "shopify-audit", sidePanelUrl: null, [SHOPIFY_AUDIT_REVIEW_REQUEST_KEY]: request });
    const opened = windowId !== null ? chrome.sidePanel.open({ windowId }) : id !== null ? chrome.sidePanel.open({ tabId: id }) : Promise.reject(new Error("Could not find this window."));
    void opened.then(() => {
      // Keep the background's panel state in step, as the other panel openers do.
      if (id !== null) chrome.runtime.sendMessage({ action: "sidePanelToggleResult", status: "opened", tabId: id, tool: "shopify-audit", source: "newtab-audit" }).catch(() => undefined);
    }).catch((cause: unknown) => {
      setAuditNotice(cause instanceof Error ? `Could not open the side panel: ${cause.message}` : "Could not open the side panel.");
    });
  };

  const handleShopifyAudit = async () => {
    if (auditMode === "sidepanel") {
      openAuditSidePanel();
      return;
    }
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
      const waiting = result.count - result.opened;
      setAuditNotice(result.count === 0
        ? `No products were created on ${result.date}.`
        : result.resumed
          ? `The ${result.date} audit is already open. Close a reviewed tab to open the next product.`
          : waiting > 0
            ? `Opened ${result.opened} of ${result.count} products from ${result.date}. Close a reviewed tab to open the next one.`
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
            <UpdateReadyButton />
            <button
              type="button"
              className="newtab-settings-button newtab-audit-button"
              onClick={() => void handleShopifyAudit()}
              disabled={auditBusy}
              aria-label="Audit Shopify products created yesterday"
              data-tooltip="Review yesterday's listings"
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
              data-tooltip="Offer calculator"
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
              data-tooltip="Scanner"
            >
              <ScanLine />
            </button>
            <button
              type="button"
              className="newtab-settings-button"
              onClick={() =>
                void chrome.runtime.sendMessage({ action: "openInSidebar", tool: "handbook", mode: "open" })
              }
              aria-label="Open Handbook in sidepanel"
              data-tooltip="Handbook"
            >
              <BookOpen />
            </button>
            <button
              type="button"
              className="newtab-settings-button"
              onClick={() =>
                void chrome.runtime.sendMessage({ action: "openMobileCapturePopup" })
              }
              aria-label="Open Volt App Clip QR code"
              data-tooltip="Connect Volt App Clip"
            >
              <AppClipQrIcon />
            </button>
            <button
              type="button"
              className="newtab-settings-button"
              onClick={() => void chrome.runtime.sendMessage({ action: "open-settings" })}
              aria-label="Open Volt settings"
              data-tooltip="Settings"
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
            ref={searchPanelRef}
          >
            <ClosedTabsPanel
              onSearchSubmit={handleSearchSubmit}
              activeMode={activeMode}
              onToggleSearchMode={setActiveMode}
            />
          </div>

        </section>

        {/* Side columns: Quick Links & Bookmarks */}
        <section className="newtab-side-columns">
          <QuickLinksColumn id="tour-quick-links" />
          <BookmarksColumn id="tour-bookmarks" />
        </section>
        <footer className="newtab-footer">
          <button className="newtab-whats-new-link" onClick={whatsNew.show} type="button">
            {whatsNew.unread && <span className="newtab-whats-new-unread" aria-label="Unread" />}
            What’s new in Volt
          </button>
        </footer>
      </div>
      {whatsNew.open && <WhatsNewDialog onClose={whatsNew.close} version={whatsNew.version} />}
    </div>
  );
}
