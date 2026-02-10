import { CsvDataManager } from "./csv-data-manager";

export interface BuyingGuideItem {
  id: string;
  category: string;
  name: string;
  requirement: string;
}

const BUYING_GUIDE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTeKgVtIvtSscPegAQ3s3ZRMIINlFHItWQxzUeAEkzh39e5Y_PTjX8Ud_fTlzTAC1lYYxodlwY0600D/pub?gid=348095671&single=true&output=csv";

const CACHE_KEY = "buyingGuideCache";

const manager = new CsvDataManager<BuyingGuideItem>({
  cacheKey: CACHE_KEY,
  url: BUYING_GUIDE_CSV_URL,
  debugPrefix: "[BuyingGuide]",
  mapRow: (row, index) => {
    // Flexible mapping trying to find standard columns
    // We try standard names, or fallback to column indices if keys are weird
    const keys = Object.keys(row);
    
    // Helper to find value by possible keys
    const getVal = (possibilities: string[], indexFallback: number) => {
        for (const p of possibilities) {
            if (row[p] !== undefined) return row[p];
            // Case insensitive check
            const key = keys.find(k => k.toLowerCase() === p.toLowerCase());
            if (key) return row[key];
        }
        // Fallback to index if available
        if (indexFallback < keys.length) return row[keys[indexFallback]];
        return "";
    };

    const category = getVal(["Category", "Group"], 0) || "General";
    const name = getVal(["Name", "Item", "Product"], 1) || "Unknown Item";
    const requirement = getVal(["Requirement", "Notes", "Guide"], 2) || "";

    // Skip if empty row (should be handled by parser but good to be safe)
    if (!category && !name && !requirement) return null;

    return {
      id: `bg-item-${index}`,
      category,
      name,
      requirement,
    };
  },
});

/**
 * Fetch Buying Guide items from Google Sheets with caching
 */
export async function fetchBuyingGuide() {
  return manager.fetchItems();
}

/**
 * Clear the cache
 */
export async function clearBuyingGuideCache() {
  return manager.clearCache();
}

/**
 * Filter items by search query
 */
export function filterBuyingGuide(
  items: BuyingGuideItem[],
  query: string
): BuyingGuideItem[] {
  if (!query.trim()) return items;

  const lowerQuery = query.toLowerCase();
  return items.filter((item) => {
    return (
      item.name.toLowerCase().includes(lowerQuery) ||
      item.category.toLowerCase().includes(lowerQuery) ||
      item.requirement.toLowerCase().includes(lowerQuery)
    );
  });
}
