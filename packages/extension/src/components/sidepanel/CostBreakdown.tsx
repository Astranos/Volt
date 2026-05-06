import React, { useMemo, useState, useEffect } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  Boxes,
  Plus,
  Trash2,
  TrendingUp,
  Save,
  FolderOpen,
  RotateCcw,
} from "lucide-react";
import SidepanelLayout from "./SidepanelLayout";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Label } from "../ui/label";

interface OrderItem {
  id: string;
  name: string;
  cost: string;
  salePrice: string;
}

interface SavedBreakdown {
  id: string;
  name: string;
  timestamp: number;
  items: OrderItem[];
  totalOrderCost: string;
}

export default function CostBreakdown() {
  const [totalOrderCost, setTotalOrderCost] = useState<string>("");
  const [items, setItems] = useState<OrderItem[]>([
    { id: "1", name: "", cost: "", salePrice: "" },
  ]);
  const [savedBreakdowns, setSavedBreakdowns] = useState<SavedBreakdown[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  // Load saved breakdowns from storage on mount
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(
        ["scout_cost_breakdowns"],
        (result: { scout_cost_breakdowns?: SavedBreakdown[] }) => {
          if (result.scout_cost_breakdowns) {
            setSavedBreakdowns(result.scout_cost_breakdowns);
          }
        }
      );
    }
  }, []);

  const saveBreakdown = () => {
    if (!saveName.trim()) return;

    const newBreakdown: SavedBreakdown = {
      id: Date.now().toString(),
      name: saveName.trim(),
      timestamp: Date.now(),
      items,
      totalOrderCost,
    };

    const updatedBreakdowns = [...savedBreakdowns, newBreakdown];
    setSavedBreakdowns(updatedBreakdowns);

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ scout_cost_breakdowns: updatedBreakdowns });
    }

    setSaveName("");
    setSaveDialogOpen(false);
  };

  const loadBreakdown = (breakdown: SavedBreakdown) => {
    setItems(breakdown.items);
    setTotalOrderCost(breakdown.totalOrderCost);
    setLoadDialogOpen(false);
  };

  const deleteBreakdown = (id: string) => {
    const updatedBreakdowns = savedBreakdowns.filter((b) => b.id !== id);
    setSavedBreakdowns(updatedBreakdowns);

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ scout_cost_breakdowns: updatedBreakdowns });
    }
  };

  const clearCurrent = () => {
    setTotalOrderCost("");
    setItems([
      { id: Date.now().toString(), name: "", cost: "", salePrice: "" },
    ]);
  };

  const numericTotalOrderCost = parseFloat(totalOrderCost) || 0;

  const breakdown = useMemo(() => {
    const parsedItems = items.map((item) => {
      const parsedCost = parseFloat(item.cost) || 0;
      const parsedSalePrice = parseFloat(item.salePrice) || 0;
      return {
        ...item,
        costValue: Number.isNaN(parsedCost) ? 0 : parsedCost,
        salePriceValue: Number.isNaN(parsedSalePrice) ? 0 : parsedSalePrice,
      };
    });

    const totalItemCosts = parsedItems.reduce(
      (sum, item) => sum + item.costValue,
      0
    );

    const totalSalePrice = parsedItems.reduce(
      (sum, item) => sum + item.salePriceValue,
      0
    );

    const remainingCost = numericTotalOrderCost - totalItemCosts;

    const calculatedItems = parsedItems.map((item) => {
      const percentage =
        numericTotalOrderCost > 0
          ? (item.costValue / numericTotalOrderCost) * 100
          : 0;
      const margin = item.salePriceValue - item.costValue;
      const marginPercentage =
        item.salePriceValue > 0 ? (margin / item.salePriceValue) * 100 : 0;
      return {
        ...item,
        percentage,
        margin,
        marginPercentage,
      };
    });

    const totalMargin = calculatedItems.reduce(
      (sum, item) => sum + item.margin,
      0
    );
    const totalMarginPercentage =
      totalSalePrice > 0 ? (totalMargin / totalSalePrice) * 100 : 0;

    return {
      items: calculatedItems,
      totalItemCosts,
      totalSalePrice,
      remainingCost,
      totalMargin,
      totalMarginPercentage,
    };
  }, [items, numericTotalOrderCost]);

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(value);
  };

  const addItem = () => {
    const newId = `${Date.now()}`;
    setItems([...items, { id: newId, name: "", cost: "", salePrice: "" }]);
  };

  const removeItem = (id: string) => {
    if (items.length <= 1) return;

    const updatedItems = items.filter((item) => item.id !== id);
    setItems(updatedItems);
  };

  const updateItemName = (id: string, name: string) => {
    const updatedItems = items.map((item) =>
      item.id === id ? { ...item, name } : item
    );
    setItems(updatedItems);
  };

  const updateItemCost = (id: string, cost: string) => {
    const updatedItems = items.map((item) =>
      item.id === id ? { ...item, cost } : item
    );
    setItems(updatedItems);
  };

  const updateItemSalePrice = (id: string, salePrice: string) => {
    const updatedItems = items.map((item) =>
      item.id === id ? { ...item, salePrice } : item
    );
    setItems(updatedItems);
  };

  return (
    <SidepanelLayout
      title="Order Cost Calculator"
      actions={
        <div className="p-2 bg-green-100 rounded-lg">
          <Boxes className="h-5 w-5 text-green-600" />
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-green-100 rounded-md">
              <Boxes className="h-4 w-4 text-green-600" />
            </div>
            <span className="font-medium text-sm">Calculator</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSaveDialogOpen(true)}
              className="h-10 w-10 p-0 text-slate-500 hover:text-slate-900"
              title="Save Breakdown"
            >
              <Save className="h-6 w-6" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLoadDialogOpen(true)}
              className="h-10 w-10 p-0 text-slate-500 hover:text-slate-900"
              title="Load Breakdown"
            >
              <FolderOpen className="h-6 w-6" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearCurrent}
              className="h-10 w-10 p-0 text-slate-500 hover:text-slate-900"
              title="Clear Form"
            >
              <RotateCcw className="h-6 w-6" />
            </Button>
          </div>
        </div>

        {/* Header with Total Order Cost */}
        <div className="space-y-3">
          <Input
            type="number"
            placeholder="Total order cost"
            value={totalOrderCost}
            onChange={(e) => setTotalOrderCost(e.target.value)}
            className="text-lg h-12 bg-slate-50 focus:bg-white"
          />

          {numericTotalOrderCost > 0 && (
            <div
              className={`p-3 rounded-lg ${
                breakdown.remainingCost >= 0
                  ? "bg-green-50"
                  : "bg-red-50"
              }`}
            >
              <div className="flex justify-between items-center">
                <span
                  className={`text-sm font-medium ${
                    breakdown.remainingCost >= 0
                      ? "text-green-700"
                      : "text-red-700"
                  }`}
                >
                  Unassigned
                </span>
                <span
                  className={`text-base font-semibold ${
                    breakdown.remainingCost >= 0
                      ? "text-green-900"
                      : "text-red-900"
                  }`}
                >
                  {formatCurrency(breakdown.remainingCost)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Items List */}
        <div className="space-y-4">
          {breakdown.items.map((item, index) => (
            <div key={item.id} className="space-y-3">
              {/* Item Header */}
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                  {index + 1}
                </span>
                <Input
                  value={item.name}
                  onChange={(e) => updateItemName(item.id, e.target.value)}
                  className="flex-1 h-9 bg-slate-50"
                  placeholder="Item name"
                />
                {items.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeItem(item.id)}
                    className="h-9 w-9 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50"
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Cost and Sale Price Inputs */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">
                    Cost
                  </label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={item.cost}
                    onChange={(e) => updateItemCost(item.id, e.target.value)}
                    className="bg-slate-50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">
                    Projection
                  </label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={item.salePrice}
                    onChange={(e) =>
                      updateItemSalePrice(item.id, e.target.value)
                    }
                    className="bg-slate-50"
                  />
                </div>
              </div>

              {/* Metrics */}
              {(item.costValue > 0 || item.salePriceValue > 0) && (
                <div className="flex gap-2 text-xs">
                  <div className="flex-1 p-2 rounded-lg bg-slate-50">
                    <div className="text-slate-600 mb-0.5">
                      % of Order
                    </div>
                    <div className="font-semibold text-slate-900">
                      {item.percentage.toFixed(1)}%
                    </div>
                  </div>
                  <div
                    className={`flex-1 p-2 rounded-lg ${
                      item.margin >= 0
                        ? "bg-green-50"
                        : "bg-amber-50"
                    }`}
                  >
                    <div
                      className={`mb-0.5 ${
                        item.margin >= 0
                          ? "text-green-700"
                          : "text-amber-700"
                      }`}
                    >
                      Margin
                    </div>
                    <div
                      className={`font-semibold ${
                        item.margin >= 0
                          ? "text-green-900"
                          : "text-amber-900"
                      }`}
                    >
                      {formatCurrency(item.margin)}
                    </div>
                  </div>
                  <div
                    className={`flex-1 p-2 rounded-lg ${
                      item.margin >= 0
                        ? "bg-green-50"
                        : "bg-amber-50"
                    }`}
                  >
                    <div
                      className={`mb-0.5 ${
                        item.margin >= 0
                          ? "text-green-700"
                          : "text-amber-700"
                      }`}
                    >
                      Margin %
                    </div>
                    <div
                      className={`font-semibold ${
                        item.margin >= 0
                          ? "text-green-900"
                          : "text-amber-900"
                      }`}
                    >
                      {item.marginPercentage.toFixed(1)}%
                    </div>
                  </div>
                </div>
              )}

              {/* Separator between items */}
              {index < items.length - 1 && (
                <div className="h-px bg-slate-200" />
              )}
            </div>
          ))}
        </div>

        {/* Add Item Button */}
        <Button
          variant="outline"
          onClick={addItem}
          className="w-full flex items-center justify-center gap-2 h-10 bg-slate-50 hover:bg-slate-100"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </Button>

        {/* Summary Stats */}
        {breakdown.totalItemCosts > 0 && (
          <div className="pt-4 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">
                Total Costs
              </span>
              <span className="text-base font-semibold text-slate-900">
                {formatCurrency(breakdown.totalItemCosts)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">
                Total Sales
              </span>
              <span className="text-base font-semibold text-slate-900">
                {formatCurrency(breakdown.totalSalePrice)}
              </span>
            </div>
            <div className="h-px bg-slate-200" />
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-slate-900 flex items-center gap-1">
                <TrendingUp className="h-4 w-4 text-green-600" />
                Total Margin
              </span>
              <div className="text-right">
                <div className="text-lg font-bold text-green-600">
                  {formatCurrency(breakdown.totalMargin)}
                </div>
                <div className="text-xs text-slate-600">
                  {breakdown.totalMarginPercentage.toFixed(1)}% margin
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Save Dialog */}
        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent className="max-w-[90%] rounded-lg bg-white">
            <DialogHeader>
              <DialogTitle>Save Breakdown</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Enter a name for this breakdown"
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveBreakdown();
                }}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button onClick={saveBreakdown} disabled={!saveName.trim()}>
                Save
              </Button>
              <Button
                variant="outline"
                onClick={() => setSaveDialogOpen(false)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Load Dialog */}
        <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
          <DialogContent className="max-w-[90%] rounded-lg bg-white">
            <DialogHeader>
              <DialogTitle>Saved Breakdowns</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {savedBreakdowns.length === 0 ? (
                <div className="text-center text-sm text-slate-500 py-4">
                  No saved breakdowns found.
                </div>
              ) : (
                savedBreakdowns.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="font-medium truncate">{b.name}</div>
                      <div className="text-xs text-slate-500">
                        {new Date(b.timestamp).toLocaleDateString()} •{" "}
                        {b.items.length} items
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => loadBreakdown(b)}
                      >
                        Load
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteBreakdown(b.id)}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setLoadDialogOpen(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </SidepanelLayout>
  );
}
