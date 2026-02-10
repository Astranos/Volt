import { CsvDataManager } from "./csv-data-manager";

export interface ShopifyHelpItem {
  id: string;
  category: string;
  name: string;
  description: string;
  tags: string;
  examples: string;
}

// Using the URL provided by the user, but adding explicit export params just in case
const SHOPIFY_HELP_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTJsicmc6_FH6oVyJUc5HvoNScmlNzgyLQ4ZyZRpEPyLWLM0vXR9_kRrbFeLPhDR6HHBExDdz9Isb6C/pub?gid=2088042013&single=true&output=csv";

const CACHE_KEY = "shopifyHelpCache";

const manager = new CsvDataManager<ShopifyHelpItem>({
  cacheKey: CACHE_KEY,
  url: SHOPIFY_HELP_CSV_URL,
  debugPrefix: "[ShopifyHelp]",
  csvParserOptions: {
    expectedHeaders: ["Category", "Name", "Description", "Tags", "Examples"],
  },
  mapRow: (row, index) => {
    // Map row data to ShopifyHelpItem
    const category = row["Category"] || row["category"];
    const name = row["Name"] || row["name"];

    // Skip if no category or name
    if (!category || !name) return null;

    const description = row["Description"] || row["description"] || "";
    const tags = row["Tags"] || row["tags"] || "";
    const examples = row["Examples"] || row["examples"] || "";

    return {
      id: `sh-item-${index}`,
      category,
      name,
      description,
      tags,
      examples,
    };
  },
});

/**
 * Fetch Shopify Help items from Google Sheets with caching
 */
export async function fetchShopifyHelp() {
  return manager.fetchItems();
}

/**
 * Clear the cache
 */
export async function clearShopifyHelpCache() {
  return manager.clearCache();
}

/**
 * Filter items by search query
 */
export function filterShopifyHelp(
  items: ShopifyHelpItem[],
  query: string
): ShopifyHelpItem[] {
  if (!query.trim()) return items;

  const lowerQuery = query.toLowerCase();
  return items.filter((item) => {
    return (
      item.name.toLowerCase().includes(lowerQuery) ||
      item.category.toLowerCase().includes(lowerQuery) ||
      item.description.toLowerCase().includes(lowerQuery) ||
      item.tags.toLowerCase().includes(lowerQuery) ||
      item.examples.toLowerCase().includes(lowerQuery)
    );
  });
}
