import React, { useState } from "react";
import { ClosedTabsPanel } from "../../src/components/newtab/ClosedTabsPanel";
import { QuickLinksColumn } from "../../src/components/newtab/QuickLinksColumn";
import { BookmarksColumn } from "../../src/components/newtab/BookmarksColumn";
import { Switch } from "../../src/components/ui/switch";
import { Label } from "../../src/components/ui/label";
import "../../src/components/cmdk-palette/styles.css";
import "../../src/components/newtab/column-styles.css";
import "../../src/components/newtab/closed-tabs-panel.css";
import "../../src/components/newtab/newtab-layout.css";

export default function NewTab() {
  const [activeMode, setActiveMode] = useState<
    "default" | "ebay" | "pricecharting"
  >("default");

  const handleEbayToggle = (checked: boolean) => {
    if (checked) {
      setActiveMode("ebay");
    } else {
      setActiveMode("default");
    }
  };

  const handlePriceChartingToggle = (checked: boolean) => {
    if (checked) {
      setActiveMode("pricecharting");
    } else {
      setActiveMode("default");
    }
  };

  return (
    <div className="newtab-root">
      <div className="newtab-container">
        {/* Header with toggles */}
        <div className="newtab-header">
          <div className="newtab-header-content">
            <img
              src="/assets/icons/logo.png"
              alt="Logo"
              className="newtab-header-logo"
            />

            <div className="newtab-header-divider" />

            <div className="newtab-toggle-group">
              <Switch
                id="pc-mode"
                checked={activeMode === "pricecharting"}
                onCheckedChange={handlePriceChartingToggle}
                className="data-[state=checked]:bg-blue-600"
              />
              <Label
                htmlFor="pc-mode"
                className="newtab-toggle-label"
              >
                PriceCharting
              </Label>
            </div>

            <div className="newtab-header-divider" />

            <div className="newtab-toggle-group">
              <Switch
                id="ebay-mode"
                checked={activeMode === "ebay"}
                onCheckedChange={handleEbayToggle}
                className="data-[state=checked]:bg-green-600"
              />
              <Label
                htmlFor="ebay-mode"
                className="newtab-toggle-label"
              >
                eBay Sold Listings
              </Label>
            </div>

          </div>
        </div>

        {/* Main layout with three columns */}
        <div className="newtab-main">
          {/* Left column: Quick Links */}
          <QuickLinksColumn />

          {/* Center column: Closed Tabs & History */}
          <div className="newtab-column newtab-column-center">
            <ClosedTabsPanel />
          </div>

          {/* Right column: Bookmarks */}
          <BookmarksColumn />
        </div>
      </div>
    </div>
  );
}
