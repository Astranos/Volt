import React, { useEffect, useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  RefreshCw,
  Search,
  Copy,
  X,
  ShoppingBag,
  Info,
} from "lucide-react";
import {
  fetchBuyingGuide,
  filterBuyingGuide,
  BuyingGuideItem,
  clearBuyingGuideCache,
} from "@/src/utils/buying-guide-data";
import SidepanelLayout from "./SidepanelLayout";
import { cn } from "@/src/lib/utils";

export default function BuyingGuide() {
  const [items, setItems] = useState<BuyingGuideItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<BuyingGuideItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load items on component mount
  useEffect(() => {
    loadItems();
  }, []);

  // Filter items when search query changes
  useEffect(() => {
    const filtered = filterBuyingGuide(items, searchQuery);
    setFilteredItems(filtered);
  }, [items, searchQuery]);

  const loadItems = async () => {
    setLoading(true);
    try {
      const { items: guideItems } = await fetchBuyingGuide();
      setItems(guideItems);
    } catch (error) {
      console.error("Failed to load buying guide:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await clearBuyingGuideCache();
      const { items: guideItems } = await fetchBuyingGuide();
      setItems(guideItems);
    } catch (error) {
      console.error("Failed to refresh buying guide:", error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleCopyRequirement = (requirement: string, itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(requirement);
    setCopiedId(itemId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Group FILTERED items by category
  const itemsByCategory = filteredItems.reduce((acc, item) => {
    const category = item.category || "General";
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, BuyingGuideItem[]>);

  // Sort categories
  const sortedCategories = Object.keys(itemsByCategory).sort((a, b) =>
    a.localeCompare(b)
  );

  // Sort items within each category alphabetically by name
  sortedCategories.forEach((category) => {
    itemsByCategory[category].sort((a, b) => a.name.localeCompare(b.name));
  });

  const filteredCategories = sortedCategories.filter(
    (cat) => itemsByCategory[cat].length > 0
  );

  return (
    <SidepanelLayout
      title="Buying Guide"
      actions={
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filteredItems.length} items
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-8 w-8"
            title="Refresh guide"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      }
      contentClassName="flex flex-col bg-muted/10"
    >
      <div className="sticky top-0 z-10 bg-background border-b border-border/50 px-4 py-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-8 bg-muted/40 border-muted-foreground/20 h-9 text-sm focus-visible:ring-offset-0"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 p-2 space-y-4 overflow-y-auto">
        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="h-8 w-8 animate-spin mb-2" />
            <p className="text-sm">Loading guide...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <div className="bg-muted/50 p-3 rounded-full mb-3">
              <ShoppingBag className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">No items found</p>
            <p className="text-xs text-muted-foreground mb-4">
              {searchQuery
                ? "Try adjusting your search query"
                : "No guide items available"}
            </p>
            {!searchQuery && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                className="h-8"
              >
                Refresh
              </Button>
            )}
          </div>
        )}

        {/* Items by Category */}
        {!loading &&
          filteredCategories.map((category) => (
            <div key={category} className="space-y-2">
              <div className="px-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {category}
                </h3>
                <div className="h-px flex-1 bg-border/50" />
              </div>

              <div className="grid gap-1">
                {itemsByCategory[category].map((item) => (
                  <div
                    key={item.id}
                    className="group relative flex items-start gap-3 p-2 rounded-md hover:bg-background hover:shadow-sm border border-transparent hover:border-border/50 transition-all duration-200"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted/50 group-hover:bg-primary/10 transition-colors mt-0.5">
                      <Info className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                          {item.name}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {item.requirement}
                      </p>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      data-action="copy"
                      onClick={(e) => handleCopyRequirement(item.requirement, item.id, e)}
                      className={cn(
                        "h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 mt-0.5",
                        copiedId === item.id &&
                          "opacity-100 text-green-500 hover:text-green-600"
                      )}
                      title="Copy Requirement"
                    >
                      {copiedId === item.id ? (
                        <span className="font-bold text-xs">✓</span>
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </SidepanelLayout>
  );
}

