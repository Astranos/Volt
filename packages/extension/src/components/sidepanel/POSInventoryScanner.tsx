import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  RefreshCw,
  Search,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  DollarSign,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

interface POSProduct {
  // Order info
  orderId: string;
  customer: string;
  purchaseDate: string;
  employeeName: string;
  daysRemaining: number;
  isOnHold: boolean;
  // Product info
  artNumber: string;
  make: string;
  model: string;
  condition: string;
  color: string;
  storageSize: string;
  carrier: string;
  batteryHealth: string;
  serial: string;
  imei: string;
  location: string;
  estPrice: string;
  offerPrice: string;
  staffNotes: string;
  osNotes: string;
  collectionName: string;
}

interface POSInventoryData {
  products: POSProduct[];
  scannedAt: number;
  totalProducts: number;
  totalOrders: number;
  url: string;
}

export default function POSInventoryScanner() {
  const [inventoryData, setInventoryData] = useState<POSInventoryData | null>(
    null
  );
  const [isScanning, setIsScanning] = useState(false);
  const [isOnPage, setIsOnPage] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<
    "all" | "ready" | "tomorrow" | "onHold"
  >("all");

  const checkIfOnPage = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const isOnInventory =
        tab?.url?.includes("pos.paymore.tech/inventory") || false;
      setIsOnPage(isOnInventory);
      return isOnInventory;
    } catch {
      return false;
    }
  }, []);

  const requestScan = useCallback(async () => {
    setIsScanning(true);
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "requestPosInventoryScan",
      });

      if (response?.data) {
        setInventoryData(response.data);
      }
    } catch (e) {
      console.error("Failed to request scan:", e);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const startContinuousScan = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;

      await chrome.tabs.sendMessage(tab.id, {
        action: "startPosInventoryScan",
      });
    } catch (e) {
      console.debug("Failed to start continuous scan:", e);
    }
  }, []);

  // Listen for inventory data from content script
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.action === "posInventoryData" && message.data) {
        setInventoryData(message.data);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Check page and start scanning on mount
  useEffect(() => {
    checkIfOnPage().then((onPage) => {
      if (onPage) {
        startContinuousScan();
        requestScan();
      }
    });

    // Listen for tab changes
    const handleTabChange = () => {
      checkIfOnPage().then((onPage) => {
        if (onPage) {
          startContinuousScan();
        }
      });
    };

    chrome.tabs.onActivated?.addListener(handleTabChange);
    chrome.tabs.onUpdated?.addListener(handleTabChange);

    return () => {
      chrome.tabs.onActivated?.removeListener(handleTabChange);
      chrome.tabs.onUpdated?.removeListener(handleTabChange);
    };
  }, [checkIfOnPage, startContinuousScan, requestScan]);

  // Computed stats
  const stats = useMemo(() => {
    if (!inventoryData?.products.length) {
      return {
        totalOrders: 0,
        totalProducts: 0,
        readyProducts: 0,
        tomorrowProducts: 0,
        onHoldProducts: 0,
        totalEstValue: "$0",
        totalOfferAmt: "$0",
      };
    }

    const products = inventoryData.products;

    // Ready to sell: products with 0 days remaining (3+ days old)
    const readyProducts = products.filter((p) => p.daysRemaining === 0).length;

    // Tomorrow: products with 1 day remaining (2 days old)
    const tomorrowProducts = products.filter((p) => p.daysRemaining === 1).length;

    // On hold: products with 2+ days remaining
    const onHoldProducts = products.filter((p) => p.daysRemaining >= 2).length;

    // Parse and sum monetary values
    const parseAmount = (str: string): number => {
      const match = str.match(/\$?([\d,]+)/);
      return match ? parseInt(match[1].replace(/,/g, ""), 10) : 0;
    };

    const totalEstValue = products.reduce(
      (sum, p) => sum + parseAmount(p.estPrice),
      0
    );
    const totalOfferAmt = products.reduce(
      (sum, p) => sum + parseAmount(p.offerPrice),
      0
    );

    return {
      totalOrders: inventoryData.totalOrders,
      totalProducts: inventoryData.totalProducts,
      readyProducts,
      tomorrowProducts,
      onHoldProducts,
      totalEstValue: `$${totalEstValue.toLocaleString()}`,
      totalOfferAmt: `$${totalOfferAmt.toLocaleString()}`,
    };
  }, [inventoryData]);

  // Search filter function - memoized for performance
  const matchesSearch = useCallback((product: POSProduct, query: string): boolean => {
    if (!query) return true;
    
    // Build searchable text from all relevant fields
    const searchableText = [
      product.make,
      product.model,
      product.orderId,
      product.artNumber,
      product.serial,
      product.imei,
      product.condition,
      product.staffNotes,
      product.osNotes,
      product.estPrice,
      product.offerPrice,
      product.customer,
      product.employeeName,
      product.collectionName,
      product.color,
      product.storageSize,
      product.carrier,
      product.location,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    
    return searchableText.includes(query);
  }, []);

  // Filtered and sorted products - computed fresh each render to ensure search works
  const filteredProducts = useMemo(() => {
    if (!inventoryData?.products?.length) return [];

    const query = searchQuery.trim().toLowerCase();
    
    // Filter products - apply search first, then status filter
    let products = inventoryData.products.filter((product) => {
      // Search filter
      if (query && !matchesSearch(product, query)) {
        return false;
      }
      
      // Status filter
      switch (filterStatus) {
        case "ready":
          return product.daysRemaining === 0;
        case "tomorrow":
          return product.daysRemaining === 1;
        case "onHold":
          return product.daysRemaining >= 2;
        default:
          return true;
      }
    });

    // Sort by days remaining (ascending) - ready items first
    return products.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [inventoryData, searchQuery, filterStatus, matchesSearch]);

  const formatLastScanned = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return new Date(timestamp).toLocaleTimeString();
  };

  if (!isOnPage) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-background">
        <Package className="w-16 h-16 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          POS Inventory Scanner
        </h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          Navigate to{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
            pos.paymore.tech/inventory
          </code>{" "}
          to scan inventory data.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => checkIfOnPage()}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Check Again
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header with scan controls */}
      <div className="flex-none p-3 border-b border-border/50 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            <span className="font-medium">Inventory Scanner</span>
          </div>
          <div className="flex items-center gap-2">
            {inventoryData && (
              <span className="text-xs text-muted-foreground">
                {formatLastScanned(inventoryData.scannedAt)}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={requestScan}
              disabled={isScanning}
            >
              <RefreshCw
                className={cn("w-4 h-4", isScanning && "animate-spin")}
              />
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        {inventoryData && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() =>
                setFilterStatus(filterStatus === "ready" ? "all" : "ready")
              }
              className={cn(
                "flex items-center gap-2 p-2 rounded-lg border transition-colors text-left",
                filterStatus === "ready"
                  ? "border-green-500 bg-green-500/10"
                  : "border-border hover:border-green-500/50"
              )}
            >
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-lg font-bold text-green-600">
                  {stats.readyProducts}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  Ready to Sell
                </div>
              </div>
            </button>

            <button
              onClick={() =>
                setFilterStatus(filterStatus === "tomorrow" ? "all" : "tomorrow")
              }
              className={cn(
                "flex items-center gap-2 p-2 rounded-lg border transition-colors text-left",
                filterStatus === "tomorrow"
                  ? "border-amber-500 bg-amber-500/10"
                  : "border-border hover:border-amber-500/50"
              )}
            >
              <Clock className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-lg font-bold text-amber-600">
                  {stats.tomorrowProducts}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  Ready Tomorrow
                </div>
              </div>
            </button>

            <button
              onClick={() =>
                setFilterStatus(filterStatus === "onHold" ? "all" : "onHold")
              }
              className={cn(
                "flex items-center gap-2 p-2 rounded-lg border transition-colors text-left",
                filterStatus === "onHold"
                  ? "border-red-500 bg-red-500/10"
                  : "border-border hover:border-red-500/50"
              )}
            >
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-lg font-bold text-red-600">
                  {stats.onHoldProducts}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  On Hold
                </div>
              </div>
            </button>

            <div className="flex items-center gap-2 p-2 rounded-lg border border-border">
              <TrendingUp className="w-5 h-5 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-lg font-bold text-primary">
                  {stats.totalProducts}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  Total ({stats.totalOrders} orders)
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Additional Stats Row */}
        {inventoryData && (
          <div className="flex gap-3 text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <DollarSign className="w-3 h-3" />
              <span>Est: {stats.totalEstValue}</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <DollarSign className="w-3 h-3" />
              <span>Paid: {stats.totalOfferAmt}</span>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search products, models, serial..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {/* Filter indicator */}
        {filterStatus !== "all" && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Showing:{" "}
              <span className="font-medium text-foreground">
                {filterStatus === "ready"
                  ? "Ready to Sell"
                  : filterStatus === "tomorrow"
                  ? "Ready Tomorrow"
                  : "On Hold"}
              </span>
            </span>
            <button
              onClick={() => setFilterStatus("all")}
              className="text-primary hover:underline"
            >
              Clear filter
            </button>
          </div>
        )}
      </div>

      {/* Product List */}
      <div className="flex-1 overflow-auto">
        {!inventoryData ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <RefreshCw className="w-8 h-8 text-muted-foreground/30 animate-spin mb-4" />
            <p className="text-sm text-muted-foreground">
              Scanning inventory...
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Expand each order row on the page to load products
            </p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <Package className="w-8 h-8 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">
              {searchQuery || filterStatus !== "all"
                ? "No products match your filters"
                : "No products found - expand order rows to load"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filteredProducts.map((product, index) => (
              <div
                key={`${product.orderId}-${product.serial || index}`}
                className={cn(
                  "p-3 hover:bg-muted/50 transition-colors",
                  product.daysRemaining === 0 && "bg-green-500/5",
                  product.daysRemaining === 1 && "bg-amber-500/5",
                  product.daysRemaining >= 2 && "bg-red-500/5"
                )}
              >
                {/* Product Header */}
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="font-medium text-sm truncate">
                    {product.make} {product.model}
                  </div>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0",
                    product.condition === "Good" && "bg-green-500/20 text-green-700",
                    product.condition === "Fair" && "bg-amber-500/20 text-amber-700",
                    product.condition === "Used" && "bg-blue-500/20 text-blue-700",
                    product.condition === "Poor" && "bg-red-500/20 text-red-700",
                    !["Good", "Fair", "Used", "Poor"].includes(product.condition) && "bg-muted text-muted-foreground"
                  )}>
                    {product.condition || "N/A"}
                  </span>
                </div>

                {/* Product Details */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <div>Order: <span className="text-foreground">{product.orderId}</span></div>
                  <div>Art#: <span className="text-foreground">{product.artNumber || "—"}</span></div>
                  <div>Est: <span className="text-foreground">{product.estPrice || "—"}</span></div>
                  <div>Offer: <span className="text-foreground">{product.offerPrice || "—"}</span></div>
                  <div>Serial: <span className="text-foreground">{product.serial || "—"}</span></div>
                  <div>Date: <span className="text-foreground">{product.purchaseDate}</span></div>
                </div>

                {/* Staff Notes */}
                {product.staffNotes && (
                  <div className="mt-1.5 text-[10px] text-amber-600 bg-amber-500/10 px-2 py-1 rounded">
                    {product.staffNotes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {inventoryData && filteredProducts.length > 0 && (
        <div className="flex-none px-3 py-2 border-t border-border/50 text-xs text-muted-foreground">
          Showing {filteredProducts.length} of {inventoryData.products.length} products
        </div>
      )}
    </div>
  );
}
