import { useState, useEffect } from "react";
import SidepanelLayout from "./SidepanelLayout";
import { ExternalLink, Copy, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";

interface PriceChartingItem {
  id: string;
  title: string;
  console: string;
  price: number;
  condition: string; // 'Loose', 'CIB', 'New', 'Graded', etc.
  url: string;
  upc?: string;
}

export default function PriceChartingTool() {
  const [savedItems, setSavedItems] = useState<PriceChartingItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load saved items on mount and listen for new items from chrome.storage
  useEffect(() => {
    // Load from localStorage first
    const saved = localStorage.getItem("scout_saved_pricecharting_lot");
    if (saved) {
      try {
        setSavedItems(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved lot", e);
      }
    }

    // Check for pending items from content script (via background)
    const processPendingItems = () => {
      chrome.storage.local.get({ scout_pricecharting_pending_items: [] }, (result) => {
        const pendingItems = result.scout_pricecharting_pending_items || [];
        if (pendingItems.length > 0) {
          setSavedItems((prev) => {
            const newItems = [...prev, ...pendingItems];
            localStorage.setItem("scout_saved_pricecharting_lot", JSON.stringify(newItems));
            return newItems;
          });
          // Clear pending items
          chrome.storage.local.set({ scout_pricecharting_pending_items: [] });
        }
      });
    };

    // Process pending items immediately
    processPendingItems();

    // Listen for storage changes (when new items are added from content script)
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.scout_pricecharting_pending_items) {
        processPendingItems();
      }
    };

    chrome.storage.local.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.local.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const removeItem = (id: string) => {
    setSavedItems(prev => {
        const next = prev.filter(item => item.id !== id);
        localStorage.setItem("scout_saved_pricecharting_lot", JSON.stringify(next));
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

  const getItemPrice = (item: PriceChartingItem) => {
    const value = typeof item.price === "number" ? item.price : Number(item.price);
    return Number.isFinite(value) ? value : 0;
  };

  const openPriceCharting = () => {
    window.open("https://www.pricecharting.com/", "_blank");
  };

  const totalValue = savedItems.reduce((acc, item) => acc + getItemPrice(item), 0);

  return (
    <SidepanelLayout className="h-full flex flex-col">
      <div className="p-4 space-y-3 border-b border-border/40 bg-background z-10">
        <div className="text-sm text-muted-foreground">
          Navigate to a game page on PriceCharting and click any price to add it to your lot.
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={openPriceCharting}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Open PriceCharting
        </Button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-4 pb-0 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Lot Items ({savedItems.length})</h3>
            {savedItems.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAll} className="h-8 px-2 text-destructive hover:text-destructive">
                Clear All
              </Button>
            )}
          </div>

          {savedItems.length > 0 && (
            <div className="p-3 border border-border/40 rounded-md bg-muted/20">
              <div className="flex justify-between items-center">
                <span className="font-semibold">Total Value</span>
                <span className="font-bold text-lg text-green-600">${totalValue.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 px-4 mt-2">
            <div className="space-y-3 pb-4">
                {savedItems.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8 text-sm">
                        No games added yet.
                    </div>
                ) : (
                    savedItems.map((item) => (
                        <Card key={item.id} className="p-3 border-border/40">
                            <div className="flex justify-between items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    <a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-sm hover:underline line-clamp-2 block" title={item.title}>
                                        {item.title}
                                    </a>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        {item.console} {item.console && item.condition ? "•" : ""} {item.condition}
                                    </div>
                                    {item.upc && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            UPC: {item.upc}
                                        </div>
                                    )}
                                </div>
                                <div className="font-bold text-sm whitespace-nowrap">
                                    ${getItemPrice(item).toFixed(2)}
                                </div>
                            </div>
                            <div className="flex gap-2 mt-3">
                                {item.upc && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1 h-8"
                                        onClick={() => copyUPC(item.upc!, item.id)}
                                    >
                                        <Copy className="h-3 w-3 mr-1" />
                                        {copiedId === item.id ? "Copied!" : "Copy UPC"}
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                                    onClick={() => removeItem(item.id)}
                                >
                                    <Trash2 className="h-3 w-3 mr-1" />
                                    Remove
                                </Button>
                            </div>
                        </Card>
                    ))
                )}
            </div>
        </ScrollArea>
      </div>
    </SidepanelLayout>
  );
}
