/* global chrome */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Package,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  DollarSign,
  Loader2,
  Store,
  Search,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  User,
  Calendar,
  Hash,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import SidepanelLayout from "./SidepanelLayout";
import { cn } from "../../lib/utils";

// ============================================
// TYPES
// ============================================

interface InventoryProduct {
  orderId: string;
  customer: string;
  numProducts: number;
  purchaseAmount: number;
  estimatedValue: number;
  estimatedMargin: number;
  grossMarginPercent: number;
  location: string;
  purchaseDate: Date;
  employeeName: string;
  daysInQueue: number;
}

interface InventorySummary {
  totalProducts: number;
  rollOffTomorrow: number;
  readyToList: number;
  readyToListValue: number;
  pendingProducts: number;
  pendingValue: number;
  products: InventoryProduct[];
}

type SortField =
  | "orderId"
  | "customer"
  | "purchaseAmount"
  | "estimatedValue"
  | "daysInQueue"
  | "purchaseDate";
type SortDirection = "asc" | "desc";

// ============================================
// ORDER ROW COMPONENT
// ============================================

function OrderRow({
  product,
  isExpanded,
  onToggle,
}: {
  product: InventoryProduct;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const formatCurrency = (value: number) =>
    value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  // Determine status based on days in queue
  const getStatusColor = () => {
    if (product.daysInQueue >= 3) return "border-l-green-500 bg-green-500/5";
    if (product.daysInQueue === 2) return "border-l-amber-500 bg-amber-500/5";
    return "border-l-muted-foreground/30";
  };

  return (
    <div
      className={cn(
        "border-l-4 rounded-r-lg transition-colors cursor-pointer hover:bg-secondary/50",
        getStatusColor()
      )}
      onClick={onToggle}
    >
      <div className="p-3">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-mono text-sm font-semibold text-primary truncate">
              {product.orderId}
            </span>
            <span className="text-xs text-muted-foreground">
              •
            </span>
            <span className="text-sm text-muted-foreground truncate">
              {product.customer}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-xs font-medium px-1.5 py-0.5 rounded",
                product.daysInQueue >= 3
                  ? "bg-green-500/20 text-green-600"
                  : product.daysInQueue === 2
                  ? "bg-amber-500/20 text-amber-600"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              {product.daysInQueue}d
            </span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Summary row */}
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Package className="h-3 w-3" />
            {product.numProducts}
          </span>
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            {formatCurrency(product.purchaseAmount)}
          </span>
          <span className="flex items-center gap-1 text-green-600">
            Est: {formatCurrency(product.estimatedValue)}
          </span>
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-border/50 space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground text-xs">Margin:</span>
                <p
                  className={cn(
                    "font-medium",
                    product.estimatedMargin > 0
                      ? "text-green-600"
                      : "text-red-500"
                  )}
                >
                  {formatCurrency(product.estimatedMargin)} (
                  {product.grossMarginPercent.toFixed(0)}%)
                </p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Location:</span>
                <p>{product.location || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Employee:</span>
                <p>{product.employeeName || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Purchased:</span>
                <p>{formatDate(product.purchaseDate)}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// INVENTORY VIEW
// ============================================

function InventoryView({
  inventory,
  isLoading,
  loadingMessage,
  onRefresh,
}: {
  inventory: InventorySummary | null;
  isLoading: boolean;
  loadingMessage: string;
  onRefresh: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("daysInQueue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const formatCurrency = (value: number) =>
    value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  // Filter and sort products
  const filteredAndSortedProducts = useMemo(() => {
    if (!inventory?.products) return [];

    let filtered = inventory.products;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.orderId.toLowerCase().includes(query) ||
          p.customer.toLowerCase().includes(query) ||
          p.employeeName.toLowerCase().includes(query) ||
          p.location.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    return [...filtered].sort((a, b) => {
      let aVal: number | string | Date;
      let bVal: number | string | Date;

      switch (sortField) {
        case "orderId":
          aVal = a.orderId;
          bVal = b.orderId;
          break;
        case "customer":
          aVal = a.customer.toLowerCase();
          bVal = b.customer.toLowerCase();
          break;
        case "purchaseAmount":
          aVal = a.purchaseAmount;
          bVal = b.purchaseAmount;
          break;
        case "estimatedValue":
          aVal = a.estimatedValue;
          bVal = b.estimatedValue;
          break;
        case "daysInQueue":
          aVal = a.daysInQueue;
          bVal = b.daysInQueue;
          break;
        case "purchaseDate":
          aVal = a.purchaseDate.getTime();
          bVal = b.purchaseDate.getTime();
          break;
        default:
          return 0;
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [inventory?.products, searchQuery, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-green-500" />
        <p className="text-sm text-muted-foreground">{loadingMessage}</p>
      </div>
    );
  }

  if (!inventory) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Package className="h-12 w-12 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground text-center">
          No inventory data available.
          <br />
          Make sure you're on the inventory page.
        </p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-2">
        {/* Roll Off Tomorrow */}
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-xl font-bold text-amber-600">
                {inventory.rollOffTomorrow}
              </p>
              <p className="text-xs text-muted-foreground">Roll Off Tomorrow</p>
            </div>
          </div>
        </div>

        {/* Ready to List */}
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-xl font-bold text-green-600">
                {inventory.readyToList}
              </p>
              <p className="text-xs text-muted-foreground">Ready to List</p>
            </div>
          </div>
        </div>

        {/* Ready Value */}
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-lg font-bold text-green-600">
                {formatCurrency(inventory.readyToListValue)}
              </p>
              <p className="text-xs text-muted-foreground">Ready Value</p>
            </div>
          </div>
        </div>

        {/* Pending */}
        <div className="p-3 rounded-lg bg-secondary/50 border border-border/50">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-xl font-bold">{inventory.pendingProducts}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </div>
        </div>
      </div>

      {/* Total bar */}
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/30 border border-border/50 text-sm">
        <span className="text-muted-foreground">
          Total: <strong className="text-foreground">{inventory.totalProducts}</strong> products
        </span>
        <span className="text-green-600 font-medium">
          {formatCurrency(inventory.readyToListValue + inventory.pendingValue)}
        </span>
      </div>

      {/* Search and Sort Controls */}
      <div className="space-y-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-secondary/50"
            placeholder="Search orders, customers..."
          />
        </div>

        {/* Sort buttons */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          <span className="text-xs text-muted-foreground mr-1">Sort:</span>
          {[
            { field: "daysInQueue" as SortField, label: "Days", icon: Clock },
            { field: "purchaseAmount" as SortField, label: "Cost", icon: DollarSign },
            { field: "estimatedValue" as SortField, label: "Value", icon: DollarSign },
            { field: "customer" as SortField, label: "Customer", icon: User },
            { field: "orderId" as SortField, label: "Order", icon: Hash },
          ].map(({ field, label, icon: Icon }) => (
            <Button
              key={field}
              variant={sortField === field ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "h-7 px-2 text-xs gap-1",
                sortField === field && "bg-secondary"
              )}
              onClick={() => handleSort(field)}
            >
              <Icon className="h-3 w-3" />
              {label}
              {sortField === field && (
                <ArrowUpDown className="h-3 w-3 ml-0.5" />
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            Orders ({filteredAndSortedProducts.length})
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {filteredAndSortedProducts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {searchQuery
                ? "No orders match your search"
                : "No orders found"}
            </div>
          ) : (
            filteredAndSortedProducts.map((product) => (
              <OrderRow
                key={product.orderId}
                product={product}
                isExpanded={expandedOrderId === product.orderId}
                onToggle={() =>
                  setExpandedOrderId(
                    expandedOrderId === product.orderId ? null : product.orderId
                  )
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function POSHelper() {
  const [currentRoute, setCurrentRoute] = useState<string>("");
  const [inventoryData, setInventoryData] = useState<InventorySummary | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Loading...");
  const [isOnPOS, setIsOnPOS] = useState(false);

  // Check if current tab is on POS
  const checkCurrentTab = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getActiveTab",
      });
      if (response?.tab?.url) {
        const url = response.tab.url;
        const onPOS = url.includes("pos.paymore.tech");
        setIsOnPOS(onPOS);

        if (onPOS) {
          // Get current route from content script
          chrome.tabs.sendMessage(
            response.tab.id,
            { action: "POS_GET_CURRENT_ROUTE" },
            (routeResponse: { route?: string } | undefined) => {
              if (routeResponse?.route) {
                setCurrentRoute(routeResponse.route);
              }
            }
          );
        }
      }
    } catch (e) {
      console.error("Failed to check current tab:", e);
    }
  }, []);

  // Listen for messages from content script
  useEffect(() => {
    const handleMessage = (
      message: any,
      _sender: unknown,
      sendResponse: (response?: unknown) => void
    ) => {
      if (message.action !== "POS_HELPER_MESSAGE") return;

      switch (message.type) {
        case "ROUTE_CHANGE":
          setCurrentRoute(message.route);
          setIsOnPOS(true);
          break;

        case "INVENTORY_DATA":
          // Parse dates back from JSON
          if (message.data?.products) {
            message.data.products = message.data.products.map((p: any) => ({
              ...p,
              purchaseDate: new Date(p.purchaseDate),
            }));
          }
          setInventoryData(message.data);
          setIsLoading(false);
          break;

        case "INVENTORY_LOADING":
          setIsLoading(message.loading);
          if (message.message) {
            setLoadingMessage(message.message);
          }
          break;
      }

      sendResponse({ received: true });
      return true;
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    checkCurrentTab();

    // Check tab periodically
    const interval = setInterval(checkCurrentTab, 3000);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      clearInterval(interval);
    };
  }, [checkCurrentTab]);

  const handleRefresh = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getActiveTab",
      });
      if (response?.tab?.id) {
        chrome.tabs.sendMessage(response.tab.id, {
          action: "POS_REFRESH_DATA",
        });
      }
    } catch (e) {
      console.error("Failed to refresh:", e);
    }
  }, []);

  const isInventory = currentRoute.includes("/inventory");

  return (
    <SidepanelLayout>
      <div className="p-4 space-y-4">
        {/* Not on POS */}
        {!isOnPOS && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Store className="h-12 w-12 text-muted-foreground/50" />
            <div className="text-center">
              <p className="text-sm font-medium">Not on POS</p>
              <p className="text-xs text-muted-foreground mt-1">
                Navigate to{" "}
                <span className="font-mono text-green-600">
                  pos.paymore.tech
                </span>{" "}
                to use this tool.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                chrome.tabs.create({ url: "https://pos.paymore.tech" });
              }}
            >
              Open POS
            </Button>
          </div>
        )}

        {/* On POS but not on inventory page */}
        {isOnPOS && !isInventory && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Package className="h-12 w-12 text-muted-foreground/50" />
            <div className="text-center">
              <p className="text-sm font-medium">Inventory Overview</p>
              <p className="text-xs text-muted-foreground mt-1">
                Navigate to <strong>/inventory</strong> to view orders and products.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                chrome.tabs.query(
                  { active: true, currentWindow: true },
                  (tabs) => {
                    if (tabs[0]?.id) {
                      chrome.tabs.update(tabs[0].id, {
                        url: "https://pos.paymore.tech/inventory",
                      });
                    }
                  }
                );
              }}
            >
              Go to Inventory
            </Button>
          </div>
        )}

        {/* Inventory View */}
        {isOnPOS && isInventory && (
          <InventoryView
            inventory={inventoryData}
            isLoading={isLoading}
            loadingMessage={loadingMessage}
            onRefresh={handleRefresh}
          />
        )}
      </div>
    </SidepanelLayout>
  );
}
