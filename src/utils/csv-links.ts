import { CsvDataManager } from "./csv-data-manager";

export interface CSVLink {
  id: string;
  title: string;
  url: string;
  category?: string;
  description?: string;
}

const DEFAULT_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSCj4wc4-d9BJO03Asa0FiHm3vYY2MOW7XcmKXM42kdBEoaCDxQNoqaIYBl5PSO_deooc1VnYl18bVo/pub?gid=9974464&single=true&output=csv";

const CACHE_KEY = "csvLinksCache";

/**
 * Get the CSV URL from settings or use default
 */
async function getCSVUrl(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["cmdkSettings"], (result) => {
      if (chrome.runtime.lastError) {
        console.log("[CSV] Error reading settings, using default URL");
        resolve(DEFAULT_CSV_URL);
        return;
      }

      const customUrl = result.cmdkSettings?.csvLinks?.customUrl;
      if (customUrl && customUrl.trim()) {
        console.log("[CSV] Using custom URL from settings");
        resolve(customUrl.trim());
      } else {
        console.log("[CSV] Using default URL");
        resolve(DEFAULT_CSV_URL);
      }
    });
  });
}

const manager = new CsvDataManager<CSVLink>({
  cacheKey: CACHE_KEY,
  url: getCSVUrl,
  debugPrefix: "[CSV]",
  csvParserOptions: {
    expectedHeaders: ["Category", "Name", "URL", "Description"],
  },
  mapRow: (row, index) => {
    // Flexible field mapping
    const category =
      row["Category"] || row["category"] || row["group"] || "General";
    const title =
      row["Name"] ||
      row["name"] ||
      row["Title"] ||
      row["title"] ||
      `Link ${index}`;
    const url = row["URL"] || row["url"] || row["link"] || "";
    const description =
      row["Description"] || row["description"] || row["desc"] || "";

    if (!url || !url.startsWith("http")) return null;

    return {
      id: `csv-link-${index}`,
      title,
      url,
      category,
      description,
    };
  },
});

/**
 * Fetch CSV links from Google Sheets with caching
 */
export async function fetchCSVLinks() {
  const result = await manager.fetchItems();
  return {
    links: result.items,
    isInitialLoad: result.isInitialLoad,
  };
}

/**
 * Clear the CSV links cache
 */
export async function clearCSVCache() {
  return manager.clearCache();
}

/**
 * Filter CSV links by search query
 */
export function filterCSVLinks(links: CSVLink[], query: string): CSVLink[] {
  if (!query.trim()) return links;

  const lowerQuery = query.toLowerCase();
  return links.filter((link) => {
    const title = link.title?.toLowerCase() || "";
    const category = link.category?.toLowerCase() || "";
    const description = link.description?.toLowerCase() || "";
    const url = link.url?.toLowerCase() || "";

    return (
      title.includes(lowerQuery) ||
      category.includes(lowerQuery) ||
      description.includes(lowerQuery) ||
      url.includes(lowerQuery)
    );
  });
}
