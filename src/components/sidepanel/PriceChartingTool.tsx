/* global chrome */
import { useState, useEffect, useRef } from "react";
import SidepanelLayout from "./SidepanelLayout";
import {
  Copy,
  ExternalLink,
  Info,
  Plus,
  Minus,
  TrendingUp,
} from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
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
    // Close existing popup if open
    if (activePopupRef.current && !activePopupRef.current.closed) {
      activePopupRef.current.close();
    }

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
      <SidepanelLayout className="h-full flex flex-col">
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
            {searchInput.trim() && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => {
                      const digitsOnly = searchInput.replace(/\D/g, "");
                      const isUpc =
                        digitsOnly.length === 12 || digitsOnly.length === 13;
                      openSearchNewTab(searchInput.trim(), isUpc);
                    }}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="border-border">
                  <p>Open in new tab</p>
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  id="tour-pc-open-site"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={openPriceCharting}
                >
                  <img
                    src={chrome.runtime.getURL(
                      "/assets/logos/pricecharting.webp"
                    )}
                    alt="PriceCharting"
                    className="h-4 w-4 object-contain brightness-0 invert"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="border-border">
                <p>
                  {searchInput.trim()
                    ? "Search PriceCharting"
                    : "Open PriceCharting"}
                </p>
              </TooltipContent>
            </Tooltip>
            <PriceChartingHelp />
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
              {savedItems.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  className="h-8 px-2 text-destructive hover:text-destructive"
                >
                  Clear All
                </Button>
              )}
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

          <ScrollArea className="flex-1 px-4 mt-2">
            <div id="tour-pc-lot-items" className="space-y-3 pb-4">
              {savedItems.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 text-sm">
                  No games added yet.
                </div>
              ) : (
                savedItems.map((item) => (
                  <Card key={item.id} className="p-3 border-border/40">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-sm hover:underline line-clamp-2 block"
                          title={item.title}
                        >
                          {item.title}
                        </a>
                        <div className="text-xs text-muted-foreground mt-1">
                          {item.console}{" "}
                          {item.console && item.condition ? "•" : ""}{" "}
                          {item.condition}
                        </div>
                        {item.upc && (
                          <div className="text-xs text-muted-foreground mt-1">
                            UPC: {item.upc}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-sm whitespace-nowrap">
                          ${getItemPrice(item).toFixed(2)}
                        </div>
                        {(item.quantity ?? 1) > 1 && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            $
                            {(
                              (typeof item.price === "number"
                                ? item.price
                                : Number(item.price)) || 0
                            ).toFixed(2)}{" "}
                            × {item.quantity ?? 1}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      {item.upc && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 h-8"
                              onClick={() => copyUPC(item.upc!, item.id)}
                            >
                              <Copy className="h-3 w-3 mr-1" />
                              {copiedId === item.id ? "Copied!" : "Copy UPC"}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="border-border">
                            <p>Copy UPC to clipboard</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {item.details && (
                        <Drawer>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <DrawerTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8"
                                >
                                  <Info className="h-3 w-3 mr-1" />
                                  Details
                                </Button>
                              </DrawerTrigger>
                            </TooltipTrigger>
                            <TooltipContent className="border-border">
                              <p>View game details</p>
                            </TooltipContent>
                          </Tooltip>
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
                                        className="grid grid-cols-[120px_1fr] gap-3 py-2 border-b border-border/40 last:border-0"
                                      >
                                        <span className="text-sm font-semibold text-muted-foreground">
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
                                          className="text-sm text-left hover:text-primary cursor-pointer transition-colors"
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
                                <Button variant="outline">Close</Button>
                              </DrawerClose>
                            </DrawerFooter>
                          </DrawerContent>
                        </Drawer>
                      )}
                      <div className="flex items-center gap-1 border border-border/40 rounded-md">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground"
                              onClick={() => updateQuantity(item.id, -1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="border-border">
                            <p>Decrease quantity</p>
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-sm font-medium min-w-[2rem] text-center">
                          {item.quantity ?? 1}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => updateQuantity(item.id, 1)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="border-border">
                            <p>Increase quantity</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </SidepanelLayout>
    </TooltipProvider>
  );
}
