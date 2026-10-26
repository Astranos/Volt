import React, { useState, useEffect, useRef } from "react";
import { Command } from "cmdk";
import { TabManager, TabInfo } from "@/src/utils/tab-manager";
import { TabItem } from "../cmdk-palette/TabItem";
import {
  HandbookCommandGroup,
  handbookCommandMatches,
  useHandbookCommandEntries,
  wantsHandbookAction,
} from "../cmdk-palette/HandbookCommandGroup";
import { RecentTabTiles } from "./RecentTabTiles";
import { ToggleGroup, ToggleGroupItem } from "@/src/components/ui/toggle-group";
import { Search as SearchIcon, Clock } from "lucide-react";
import { type SearchMode } from "./NewTabHelp";
import { ShopifyCompareTray, ShopifyProductResults, type ShopifyProductSearchState } from "./ShopifyProductResults";
import { searchShopifyProducts, setShopifyProductHidden, type ShopifySearchProduct } from "../../shopify-audit/client";
import { useShopifyStores } from "../../shopify-audit/use-shopify-stores";
import { useKioskQueue, useKioskStore } from "../../kiosk/use-kiosk";
import { MAX_COMPARE_PRODUCTS } from "../../domain/shopify-audit";
import { shopifyComparePath } from "../../shopify-compare/compare-url";
import {
  getSearchPrefixMode,
  NEW_TAB_SEARCH_PROVIDERS,
  parseSearchPrefix,
} from "@/src/domain/search-intent";
import "./closed-tabs-panel.css";

interface ClosedTabsPanelProps {
  onSearchSubmit?: (query: string) => void;
  activeMode?: SearchMode;
  onToggleSearchMode?: (mode: SearchMode) => void;
}

const SEARCH_MODE_OPTIONS: Array<{
  mode: SearchMode;
  label: string;
  id: string;
}> = [
  { mode: "shopify", label: "Shopify", id: "tour-search-shopify" },
  {
    mode: "pricecharting",
    label: "PriceCharting",
    id: "tour-search-pricecharting",
  },
  { mode: "barcodelookup", label: "UPC", id: "tour-search-upc" },
  { mode: "ebay", label: "eBay", id: "tour-search-ebay" },
];

export function ClosedTabsPanel({
  onSearchSubmit,
  activeMode = "shopify",
  onToggleSearchMode,
}: ClosedTabsPanelProps) {
  const [search, setSearch] = useState("");
  const [closedTabs, setClosedTabs] = useState<TabInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedValue, setSelectedValue] = useState<string>("");
  const [shopifySearch, setShopifySearch] = useState<ShopifyProductSearchState>({ kind: "idle" });
  const [shopifyRetry, setShopifyRetry] = useState(0);
  const [compareProducts, setCompareProducts] = useState<ShopifySearchProduct[]>([]);
  // Compare mode can be turned on before anything is picked (the Compare button).
  const [compareModeOn, setCompareModeOn] = useState(false);
  const compareMode = compareModeOn || compareProducts.length > 0;
  // Kiosk "Ask to see item" requests for the store chosen in settings.
  const [kioskStore] = useKioskStore();
  const kioskQueue = useKioskQueue(kioskStore);
  const kioskWaiting = kioskQueue.requests.filter((request) => request.status === "waiting").length;
  const shopifyStores = useShopifyStores();
  const shopifyShop = shopifyStores.connection?.shop ?? null;
  const refreshShopifyStores = shopifyStores.refresh;
  const leaveCompare = () => {
    setCompareModeOn(false);
    setCompareProducts([]);
  };
  // Picks can't be compared across stores, so switching stores clears them.
  useEffect(() => { setCompareProducts([]); }, [shopifyShop]);
  const shopifySearchGeneration = useRef(0);
  // Set once the user moves the selection with the keyboard or pointer during the
  // current query. cmdk also selects the first row on its own (for example a handbook
  // row while Shopify loads); only a row the user picked may take over Enter.
  const userPickedRef = useRef(false);
  const userPickedHandbook = () => selectedValue.startsWith("handbook-") && userPickedRef.current;
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedSearch = search.trim();
  const prefixedSearch = parseSearchPrefix(trimmedSearch);
  const displayedMode = prefixedSearch.mode ?? activeMode;
  const displayedQuery = prefixedSearch.mode ? prefixedSearch.query : trimmedSearch;
  const handbookEntries = useHandbookCommandEntries(displayedQuery.trim().length >= 2);
  const handbookMatches = handbookCommandMatches(handbookEntries, displayedQuery);
  const showHandbookAction = wantsHandbookAction(displayedQuery, handbookMatches);

  useEffect(() => {
    const query = displayedQuery.trim();
    if (displayedMode !== "shopify" || query.length < 2) {
      setShopifySearch({ kind: "idle" });
      return;
    }
    // Wait to learn the active store so a switch can't race the first search.
    if (!shopifyStores.loaded) return;
    let canceled = false;
    shopifySearchGeneration.current++;
    setShopifySearch({ kind: "loading", query });
    const timer = window.setTimeout(() => {
      void searchShopifyProducts(query, shopifyShop ?? undefined)
        .then((result) => {
          if (canceled) return;
          setShopifySearch({ kind: "ready", query, result });
          // Keep a handbook entry only if the user picked it.
          setSelectedValue((current) => current.startsWith("handbook-") && userPickedRef.current ? current
            : result.products[0] ? `shopify-product-${result.products[0].id}` : "");
        })
        .catch((cause: unknown) => {
          if (canceled) return;
          setShopifySearch({ kind: "error", query, message: cause instanceof Error ? cause.message : "Could not search Shopify." });
          // The active store may have been disconnected elsewhere; re-checking applies
          // the fallback store, which reruns this search if it changed.
          void refreshShopifyStores().catch(() => undefined);
        });
    }, 280);
    return () => { canceled = true; window.clearTimeout(timer); };
  }, [displayedMode, displayedQuery, shopifyRetry, shopifyStores.loaded, shopifyShop, refreshShopifyStores]);

  const hideShopifyProduct = async (product: ShopifySearchProduct) => {
    const withoutProduct = (current: ShopifyProductSearchState): ShopifyProductSearchState => current.kind === "ready"
      ? { ...current, result: { ...current.result, products: current.result.products.filter((item) => item.id !== product.id) } }
      : current;
    const generation = shopifySearchGeneration.current;
    const shop = shopifySearch.kind === "ready" ? shopifySearch.result.shop : undefined;
    setShopifySearch(withoutProduct);
    try {
      await setShopifyProductHidden(product, true, shop);
    } catch (cause) {
      // Only report the failure on the results it came from.
      if (generation !== shopifySearchGeneration.current) return;
      setShopifySearch((current) => current.kind === "ready"
        ? { kind: "error", query: current.query, message: cause instanceof Error ? cause.message : "Could not hide the product." }
        : current);
    }
  };

  const toggleCompare = (product: ShopifySearchProduct) => {
    setCompareProducts((current) => current.some((item) => item.id === product.id)
      ? current.filter((item) => item.id !== product.id)
      : current.length < MAX_COMPARE_PRODUCTS ? [...current, product] : current);
  };

  const openCompare = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL(shopifyComparePath(compareProducts.map((product) => product.id), shopifyShop)), active: true });
  };

  // Treat clicks anywhere on the search row's padding/icon area as a
  // request to focus the input, except when they land on a real control.
  const focusInputFromRow = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target === inputRef.current) return;
    if (target.closest('button, input, [role="button"], a')) return;
    e.preventDefault();
    inputRef.current?.focus();
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const tabs = await TabManager.getClosedTabs();
      // Filter out newtab pages and empty URLs
      const filtered = tabs.filter(
        (tab) =>
          tab.url &&
          !tab.url.startsWith("chrome://newtab") &&
          !tab.url.startsWith("about:blank")
      );
      setClosedTabs(filtered);
    } finally {
      setLoading(false);
    }
  };

  // Provider modes show recently closed tabs until the user starts typing a search.
  const showTiles = displayedMode !== "shopify" && !trimmedSearch && closedTabs.length > 0;
  const topTiles = showTiles ? closedTabs.slice(0, 4) : [];
  const listTabs = showTiles ? closedTabs.slice(4) : [];

  // Build a single intermixed list of closed tabs
  const combinedItems: Array<
    | { type: "tab"; tab: TabInfo; value: string }
  > = [
    ...listTabs.map((tab) => ({
      type: "tab" as const,
      tab,
      value: `tab-${tab.id}`,
    })),
  ];

  const getSearchProviderTitle = () => {
    const provider = NEW_TAB_SEARCH_PROVIDERS.find(
      (candidate) => candidate.id === displayedMode
    );
    return provider?.name ?? "";
  };

  const getSearchPlaceholder = () => {
    switch (activeMode) {
      case "ebay":
        return "Search on eBay (sold prices)";
      case "pricecharting":
        return "Search on PriceCharting";
      case "barcodelookup":
        return "Search on BarcodeLookup (UPC)";
      default:
        return "Search your Shopify products...";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Arrow key navigation itself is handled by CMDK.
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) userPickedRef.current = true;
  };

  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === " " || e.key === "Spacebar") {
      const prefixMode = getSearchPrefixMode(search);
      if (prefixMode) {
        e.preventDefault();
        setSearch("");
        if (listRef.current) {
          listRef.current.scrollTop = 0;
        }
        if (prefixMode !== activeMode) {
          onToggleSearchMode?.(prefixMode);
        }
        return;
      }
    }

    if (e.key !== "Enter" || userPickedHandbook()) return;
    if (displayedMode === "shopify") {
      // A handbook row cmdk selected by itself (Shopify still loading) must not copy or open.
      if (selectedValue.startsWith("handbook-")) e.preventDefault();
    } else if (onSearchSubmit) {
      e.preventDefault();
      onSearchSubmit(search);
    }
  };

  const handleSelect = async (value: string) => {
    if (value.startsWith("tab-")) {
      const sessionId = value.replace("tab-", "");
      restoreSession(sessionId);
    }
  };

  const restoreSession = (sessionId: string) => {
    // Get current tab ID to close it after restoration
    chrome.tabs.getCurrent(async (currentTab) => {
      await TabManager.restoreTab(sessionId, currentTab?.id);
    });
  };

  // Command wraps the search input too, so arrow keys typed in it move the selection.
  return (
    <Command
      shouldFilter={false}
      filter={() => 1}
      onKeyDown={handleKeyDown}
      className="closed-tabs-panel"
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <div
        className="closed-tabs-search-container"
        onMouseDown={focusInputFromRow}
        // Enter on the mode toggles must activate them, not cmdk's selected result.
        onKeyDown={(e) => { if (e.key === "Enter" && e.target !== inputRef.current) e.stopPropagation(); }}
      >
        <div className="closed-tabs-search">
          <SearchIcon className="w-4 h-4 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder={getSearchPlaceholder()}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              userPickedRef.current = false;
              if (listRef.current) {
                listRef.current.scrollTop = 0;
              }
            }}
            onKeyDown={handleSearchInputKeyDown}
            className="closed-tabs-search-input"
            autoFocus
            tabIndex={1}
          />
        </div>

        {/* Integrated search mode toggle */}
        <ToggleGroup
          type="single"
          value={displayedMode}
          onValueChange={(value) => {
            if (value) {
              onToggleSearchMode?.(value as SearchMode);
            }
          }}
          className="closed-tabs-search-toggle"
        >
          {SEARCH_MODE_OPTIONS.map((option) => (
            <ToggleGroupItem
              key={option.mode}
              id={option.id}
              value={option.mode}
              size="sm"
              className="text-xs px-2"
            >
              <span>{option.label}</span>
              {option.mode === "shopify" && kioskWaiting > 0 && (
                <span aria-label={`${kioskWaiting} kiosk requests waiting`} className="shopify-mode-count" title="Customers waiting at the kiosk">{kioskWaiting}</span>
              )}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="closed-tabs-command">
        <div className="closed-tabs-scroll">
          {showTiles && (
            <div id="tour-recent-tabs" className="closed-tabs-tiles-section">
              <div className="closed-tabs-section-label">
                <Clock className="w-3.5 h-3.5" />
                <span>Pick up where you left off</span>
                <span className="closed-tabs-section-hint">
                  Ctrl+Shift+Z reopens last tab
                </span>
              </div>
              <RecentTabTiles tabs={topTiles} onRestore={restoreSession} />
            </div>
          )}

          <Command.List
            className={displayedMode === "shopify" ? "closed-tabs-list shopify-results-list" : "closed-tabs-list"}
            ref={listRef}
            onPointerMove={() => { userPickedRef.current = true; }}
          >
            {displayedMode === "shopify" ? (
              <ShopifyProductResults
                query={displayedQuery.trim()}
                state={shopifySearch}
                onOpenProduct={(url) => { void chrome.tabs.create({ url, active: true }); }}
                onHideProduct={(product) => { void hideShopifyProduct(product); }}
                compareIds={new Set(compareProducts.map((product) => product.id))}
                compareFull={compareProducts.length >= MAX_COMPARE_PRODUCTS}
                compareMode={compareMode}
                onToggleCompare={toggleCompare}
                onToggleCompareMode={() => { if (compareMode) leaveCompare(); else setCompareModeOn(true); }}
                onRetry={() => setShopifyRetry((current) => current + 1)}
                onOpenSettings={() => { void chrome.tabs.create({ url: chrome.runtime.getURL("/options.html#shopify-audit"), active: true }); }}
                stores={shopifyStores.connection && shopifyStores.connection.shops.length > 1
                  ? { shops: shopifyStores.connection.shops, active: shopifyStores.connection.shop, onSelect: (shop) => { void shopifyStores.select(shop).catch(() => undefined); } }
                  : null}
                kiosk={kioskStore ? { store: kioskStore, shop: shopifyShop, requests: kioskQueue.requests, clockOffset: kioskQueue.clockOffset, error: kioskQueue.error, busy: kioskQueue.busy, onUpdate: kioskQueue.update } : null}
              />
            ) : loading ? (
              <div className="closed-tabs-loading">
                <p>Loading...</p>
              </div>
            ) : (
              <>
                {trimmedSearch && onSearchSubmit && (
                  <Command.Item
                    key="search-action"
                    value="search-action"
                    onSelect={() => onSearchSubmit(trimmedSearch)}
                    className="closed-tabs-item"
                  >
                    <div className="flex items-center gap-3 px-4 py-3 w-full">
                      <div className="closed-tabs-search-action-icon rounded p-2">
                        <SearchIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          Search for "{displayedQuery}" on{" "}
                          {getSearchProviderTitle()}
                        </p>
                        <p className="text-xs text-gray-500">
                          Press <kbd className="cmdk-kbd">Enter</kbd> to search
                        </p>
                      </div>
                      <div className="cmdk-item-kbd-hint">
                        <kbd className="cmdk-kbd">↵</kbd>
                      </div>
                    </div>
                  </Command.Item>
                )}

                {showTiles && combinedItems.length > 0 && (
                  <div
                    id="tour-earlier-today"
                    className="closed-tabs-section-label closed-tabs-section-label-inline"
                  >
                    <span>Earlier today</span>
                  </div>
                )}

                {combinedItems.length === 0 && !trimmedSearch && topTiles.length === 0 ? (
                  <Command.Empty className="closed-tabs-empty">
                    <p>No recently closed tabs found</p>
                  </Command.Empty>
                ) : (
                  // Single list of closed tabs
                  combinedItems.map((entry) => (
                    <Command.Item
                      key={entry.value}
                      value={entry.value}
                      onSelect={handleSelect}
                      className="closed-tabs-item"
                    >
                      <TabItem
                        tab={entry.tab}
                        kbdHintAction="Restore tab"
                        showRelativeTime
                      />
                    </Command.Item>
                  ))
                )}
              </>
            )}
            {/* Below the main results and never preselected, so Enter keeps opening
                the top product or running the search unless the user picks an entry. */}
            <HandbookCommandGroup
              matches={handbookMatches}
              showOpenAction={showHandbookAction}
              itemClassName="closed-tabs-item"
            />
          </Command.List>
        </div>
      </div>
      {displayedMode === "shopify" && compareProducts.length > 0 && (
        <ShopifyCompareTray
          products={compareProducts}
          onRemove={toggleCompare}
          onClear={leaveCompare}
          onCompare={openCompare}
        />
      )}
    </Command>
  );
}
