/* global chrome */
import { useState, useEffect, useRef } from "react";
import SidepanelLayout from "./SidepanelLayout";
import { ExternalLink, Plus, Minus } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../ui/drawer";
import { PriceChartingHelp } from "./PriceChartingHelp";

interface PriceChartingItem {
  id: string;
  title: string;
  console: string;
  price: number;
  condition: string; // 'Loose', 'CIB', 'New', 'Graded', etc.
  url: string;
  upc?: string;
  imageUrl?: string;
  details?: Record<string, string> | null;
  quantity?: number; // Default to 1 if not present
}

export default function PriceChartingTool() {
  const [savedItems, setSavedItems] = useState<PriceChartingItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const activePopupRef = useRef<Window | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load saved items on mount and listen for new items from chrome.storage
  useEffect(() => {
    // Load from localStorage first
    const saved = localStorage.getItem("scout_saved_pricecharting_lot");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Ensure all items have quantity (default to 1 for existing items)
        const itemsWithQuantity = parsed.map((item: PriceChartingItem) => ({
          ...item,
          quantity: item.quantity ?? 1,
        }));
        setSavedItems(itemsWithQuantity);
      } catch (e) {
        console.error("Failed to parse saved lot", e);
      }
    }

    // Check for pending items from content script (via background)
    const processPendingItems = () => {
      chrome.storage.local.get(
        { scout_pricecharting_pending_items: [] },
        (result) => {
          const pendingItems = result.scout_pricecharting_pending_items || [];
          if (pendingItems.length > 0) {
            setSavedItems((prev) => {
              // Ensure pending items have quantity
              const itemsWithQuantity = pendingItems.map(
                (item: PriceChartingItem) => ({
                  ...item,
                  quantity: item.quantity ?? 1,
                })
              );
              const newItems = [...prev, ...itemsWithQuantity];
              localStorage.setItem(
                "scout_saved_pricecharting_lot",
                JSON.stringify(newItems)
              );
              return newItems;
            });
            // Clear pending items
            chrome.storage.local.set({ scout_pricecharting_pending_items: [] });
          }
        }
      );
    };

    // Process pending items immediately
    processPendingItems();

    // Listen for storage changes (when new items are added from content script)
    const handleStorageChange = (changes: { [key: string]: any }) => {
      if (changes.scout_pricecharting_pending_items) {
        processPendingItems();
      }
      // Close popup if requested from content script
      if (changes.scout_close_pc_popup) {
        if (activePopupRef.current && !activePopupRef.current.closed) {
          activePopupRef.current.close();
          activePopupRef.current = null;
          // Focus and select the input for next query
          setTimeout(() => {
            if (searchInputRef.current) {
              searchInputRef.current.focus();
              searchInputRef.current.select();
            }
          }, 100);
        }
      }
    };

    chrome.storage.local.onChanged.addListener(handleStorageChange);

    // Auto-dismiss popup when window regains focus
    const handleFocus = () => {
      if (activePopupRef.current && !activePopupRef.current.closed) {
        activePopupRef.current.close();
        activePopupRef.current = null;
        // Focus and select the input for next query
        setTimeout(() => {
          if (searchInputRef.current) {
            searchInputRef.current.focus();
            searchInputRef.current.select();
          }
        }, 100);
      }
    };

    window.addEventListener("focus", handleFocus);

    // Poll to check if popup was closed manually
    const popupCheckInterval = setInterval(() => {
      if (
        activePopupRef.current &&
        activePopupRef.current.closed &&
        searchInputRef.current
      ) {
        activePopupRef.current = null;
        searchInputRef.current.focus();
        searchInputRef.current.select();
      }
    }, 500);

    return () => {
      chrome.storage.local.onChanged.removeListener(handleStorageChange);
      window.removeEventListener("focus", handleFocus);
      clearInterval(popupCheckInterval);
    };
  }, []);

  const updateQuantity = (id: string, delta: number) => {
    setSavedItems((prev) => {
      const next = prev
        .map((item) => {
          if (item.id === id) {
            const newQuantity = Math.max(0, (item.quantity ?? 1) + delta);
            // Remove item if quantity reaches 0
            if (newQuantity === 0) {
              return null;
            }
            return { ...item, quantity: newQuantity };
          }
          return item;
        })
        .filter((item): item is PriceChartingItem => item !== null);
      localStorage.setItem(
        "scout_saved_pricecharting_lot",
        JSON.stringify(next)
      );
      return next;
    });
  };

  const clearAll = () => {
    if (confirm("Clear all saved items?")) {
      setSavedItems([]);
      localStorage.removeItem("scout_saved_pricecharting_lot");
    }
  };

  const copyUPC = async (upc: string, itemId: string) => {
    try {
      await navigator.clipboard.writeText(upc);
      setCopiedId(itemId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy UPC:", err);
    }
  };

  const copyValue = async (value: string, itemId: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(`${itemId}-${field}`);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy value:", err);
    }
  };

  const getItemPrice = (item: PriceChartingItem) => {
    const value =
      typeof item.price === "number" ? item.price : Number(item.price);
    const price = Number.isFinite(value) ? value : 0;
    const quantity = item.quantity ?? 1;
    return price * quantity;
  };

  const openPriceCharting = () => {
    let url = "https://www.pricecharting.com/";

    // If there's a search query, use it
    if (searchInput.trim()) {
      const digitsOnly = searchInput.replace(/\D/g, "");
      const isUpc = digitsOnly.length === 12 || digitsOnly.length === 13;
      const searchType = isUpc ? "prices" : "videogames";
      url = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(
        searchInput.trim()
      )}&type=${searchType}`;
    }

    // Open in active tab instead of popup
    chrome.tabs.create({ url, active: true });
  };

  const openSearchPopup = (query: string, isUpc: boolean = false) => {
    // Close existing popup if open
    if (activePopupRef.current && !activePopupRef.current.closed) {
      activePopupRef.current.close();
    }

    const searchType = isUpc ? "prices" : "videogames";
    const url = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(
      query
    )}&type=${searchType}`;

    const width = 1100;
    const height = 800;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    activePopupRef.current = window.open(
      url,
      "scout_pricecharting_popup",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
  };

  const openSearchNewTab = (query: string, isUpc: boolean = false) => {
    const searchType = isUpc ? "prices" : "videogames";
    const url = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(
      query
    )}&type=${searchType}`;
    window.open(url, "_blank");
  };

  const openItemPopup = (url: string) => {
    // Close existing popup if open
    if (activePopupRef.current && !activePopupRef.current.closed) {
      activePopupRef.current.close();
    }

    const width = 1100;
    const height = 800;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    activePopupRef.current = window.open(
      url,
      "scout_pricecharting_popup",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
  };

  const handleSearchInput = (value: string) => {
    setSearchInput(value);

    // Check if it's a valid UPC (12 or 13 digits, all numeric)
    const digitsOnly = value.replace(/\D/g, "");
    if (digitsOnly.length === 12 || digitsOnly.length === 13) {
      // Auto-open popup for UPC codes
      openSearchPopup(digitsOnly, true);
    }
  };

  const handleSearchSubmit = () => {
    if (!searchInput.trim()) return;

    const digitsOnly = searchInput.replace(/\D/g, "");
    const isUpc = digitsOnly.length === 12 || digitsOnly.length === 13;
    openSearchPopup(searchInput.trim(), isUpc);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearchSubmit();
    }
  };

  const totalValue = savedItems.reduce(
    (acc, item) => acc + getItemPrice(item),
    0
  );

  return (
    <TooltipProvider>
      <SidepanelLayout className="h-full flex flex-col overflow-hidden">
        <div className="p-4 space-y-3 border-b border-border/40 bg-background z-10">
          <div className="flex gap-2">
            <input
              ref={searchInputRef}
              id="tour-pc-search"
              type="text"
              placeholder="Enter UPC code or game name..."
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  id="tour-pc-open-site"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => {
                    if (searchInput.trim()) {
                      const digitsOnly = searchInput.replace(/\D/g, "");
                      const isUpc =
                        digitsOnly.length === 12 || digitsOnly.length === 13;
                      openSearchNewTab(searchInput.trim(), isUpc);
                    } else {
                      openPriceCharting();
                    }
                  }}
                >
                  {searchInput.trim() ? (
                    <ExternalLink className="h-4 w-4" />
                  ) : (
                    <img
                      src={chrome.runtime.getURL(
                        "/assets/logos/pricecharting.webp"
                      )}
                      alt="PriceCharting"
                      className="h-4 w-4 object-contain brightness-0 invert"
                    />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="border-border">
                <p>
                  {searchInput.trim()
                    ? "Open in new tab"
                    : "Open PriceCharting"}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div
            id="tour-pc-instruction"
            className="text-sm text-muted-foreground"
          >
            Click on the{" "}
            <span className="inline-block bg-[#22c55e] text-white px-2 py-0.5 rounded text-[11px] font-semibold leading-tight whitespace-nowrap">
              Add To Game Lot
            </span>{" "}
            button for the price of the game to add to your lot.
          </div>
        </div>

          <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 pb-0 space-y-3">
            <div className="flex items-center justify-between">
              <h3 id="tour-pc-lot-summary" className="font-semibold text-sm">
                Lot Items (
                {savedItems.reduce(
                  (sum, item) => sum + (item.quantity ?? 1),
                  0
                )}
                )
              </h3>
              <div className="flex items-center gap-2">
                {savedItems.length > 0 ? (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <PriceChartingHelp />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="border-border">
                        <p>View Guide</p>
                      </TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearAll}
                      className="h-9 px-3 text-destructive hover:text-destructive"
                    >
                      Clear All
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="hidden">
                      <PriceChartingHelp />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const helpButton = document.querySelector(
                          '[title="View Guide"]'
                        ) as HTMLButtonElement;
                        helpButton?.click();
                      }}
                      className="h-9 px-3 text-muted-foreground hover:text-green-600 transition-colors"
                    >
                      View Guide
                    </Button>
                  </>
                )}
              </div>
            </div>

            {savedItems.length > 0 && (
              <div
                id="tour-pc-total-value"
                className="p-3 border border-border/40 rounded-md bg-muted/20"
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold">Total Value</span>
                  <span className="font-bold text-lg text-green-600">
                    ${totalValue.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <ScrollArea className="flex-1 px-4 mt-2 [&>[data-radix-scroll-area-viewport]]:!overflow-y-scroll">
            <div id="tour-pc-lot-items" className="space-y-1.5 pb-4">
              {savedItems.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 text-sm">
                  No games added yet.
                </div>
              ) : (
                savedItems.map((item) => (
                  <div
                    key={item.id}
                    className="group rounded-lg border border-border/40 bg-card overflow-hidden"
                  >
                    {/* Main content area with optional image */}
                    <div className="flex gap-3 p-3">
                      {/* Game cover image */}
                      {item.imageUrl && (
                        <div className="shrink-0">
                          <img
                            src={item.imageUrl}
                            alt={item.title}
                            className="w-14 h-auto rounded object-cover bg-muted"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                      )}

                      {/* Title, badges, price */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* Title row with price */}
                        <div className="flex items-start justify-between gap-2">
                          <span
                            onClick={() => openItemPopup(item.url)}
                            className="text-sm font-semibold leading-tight text-foreground hover:text-green-600 cursor-pointer transition-colors line-clamp-2"
                            title={item.title}
                          >
                            {item.title}
                          </span>
                          <span className="shrink-0 text-base font-bold text-green-600 tabular-nums">
                            ${getItemPrice(item).toFixed(2)}
                          </span>
                        </div>

                        {/* Badges row */}
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge
                            variant="secondary"
                            className="px-1.5 py-0 text-[10px] font-medium"
                          >
                            {item.console}
                          </Badge>
                          {item.condition && (
                            <Badge
                              variant="secondary"
                              className="px-1.5 py-0 text-[10px] font-medium"
                            >
                              {item.condition}
                            </Badge>
                          )}
                          {(item.quantity ?? 1) > 1 && (
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              $
                              {(
                                (typeof item.price === "number"
                                  ? item.price
                                  : Number(item.price)) || 0
                              ).toFixed(2)}{" "}
                              × {item.quantity}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Bottom action bar */}
                    <div className="px-3 pb-3 flex items-center gap-2">
                      {/* Large UPC button */}
                      {item.upc && (
                        <Button
                          variant="outline"
                          onClick={() => copyUPC(item.upc!, item.id)}
                          className="flex-1 h-9 font-mono text-sm tracking-wide hover:border-green-600 hover:text-green-600 transition-colors"
                          title="Click to copy UPC"
                        >
                          {copiedId === item.id ? "Copied!" : item.upc}
                        </Button>
                      )}

                      {/* Details button */}
                      {item.details && (
                        <Drawer>
                          <DrawerTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 text-xs shrink-0"
                            >
                              Details
                            </Button>
                          </DrawerTrigger>
                          <DrawerContent>
                            <DrawerHeader>
                              <DrawerTitle>{item.title}</DrawerTitle>
                              <DrawerDescription>
                                {item.console} • {item.condition}
                              </DrawerDescription>
                            </DrawerHeader>
                            <div className="px-4 pb-4">
                              <div className="space-y-2">
                                {(() => {
                                  const allowedFields = [
                                    "Genre",
                                    "Release Date",
                                    "ESRB Rating",
                                    "Publisher",
                                    "Notes",
                                  ];
                                  return Object.entries(item.details)
                                    .filter(([key]) =>
                                      allowedFields.includes(key)
                                    )
                                    .map(([key, value]) => (
                                      <div
                                        key={key}
                                        className="flex justify-between gap-3 py-1.5 border-b border-border/40 last:border-0"
                                      >
                                        <span className="text-xs text-muted-foreground">
                                          {key}
                                        </span>
                                        <button
                                          onClick={() =>
                                            copyValue(
                                              value,
                                              item.id,
                                              key
                                                .toLowerCase()
                                                .replace(/\s+/g, "-")
                                            )
                                          }
                                          className="text-xs text-right hover:text-green-600 cursor-pointer transition-colors"
                                          title="Click to copy"
                                        >
                                          {copiedId ===
                                          `${item.id}-${key
                                            .toLowerCase()
                                            .replace(/\s+/g, "-")}`
                                            ? "Copied!"
                                            : value}
                                        </button>
                                      </div>
                                    ));
                                })()}
                              </div>
                            </div>
                            <DrawerFooter>
                              <DrawerClose asChild>
                                <Button variant="outline" size="sm">
                                  Close
                                </Button>
                              </DrawerClose>
                            </DrawerFooter>
                          </DrawerContent>
                        </Drawer>
                      )}

                      {/* Quantity stepper */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => updateQuantity(item.id, -1)}
                          aria-label="Decrease quantity"
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">
                          {item.quantity ?? 1}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => updateQuantity(item.id, 1)}
                          aria-label="Increase quantity"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </SidepanelLayout>
    </TooltipProvider>
  );
}
