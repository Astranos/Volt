import { toast } from "@/src/components/ui/use-toast";

export interface CsvDataManagerConfig<T> {
  cacheKey: string;
  url: string | (() => Promise<string>);
  /**
   * Map a raw CSV row (key-value pairs based on header) to the target type T.
   * Return null to skip the row.
   */
  mapRow: (row: Record<string, string>, index: number) => T | null;
  cacheDuration?: number; // Default 30 mins
  debugPrefix?: string;
  csvParserOptions?: {
    expectedHeaders?: string[]; // Useful for single-line CSVs to determine column count
    hasHeaders?: boolean; // Default true. If false, must provide expectedHeaders or we use indices.
  };
}

export interface FetchResult<T> {
  items: T[];
  isInitialLoad: boolean;
}

export class CsvDataManager<T> {
  private config: CsvDataManagerConfig<T>;
  private cacheTimestampKey: string;

  constructor(config: CsvDataManagerConfig<T>) {
    this.config = {
      cacheDuration: 1000 * 60 * 30, // 30 minutes default
      debugPrefix: "[CsvDataManager]",
      ...config,
    };
    this.cacheTimestampKey = `${this.config.cacheKey}Timestamp`;
  }

  private log(message: string, ...args: unknown[]) {
    if (process.env.NODE_ENV === "development") {
      console.log(`${this.config.debugPrefix} ${message}`, ...args);
    }
  }

  private error(message: string, ...args: unknown[]) {
    console.error(`${this.config.debugPrefix} ${message}`, ...args);
  }

  /**
   * Fetch items with caching strategy
   */
  public async fetchItems(): Promise<FetchResult<T>> {
    try {
      // Try to get cached data first
      const result = await this.getCachedItems();
      if (result.cached) {
        this.log("Using cached items:", result.cached.length);
        // Return cached data immediately, but refresh in background if expired
        if (result.isExpired) {
          this.log("Cache expired, refreshing in background");
          this.refreshInBackground();
        }
        return { items: result.cached, isInitialLoad: false };
      }

      // No cache, fetch fresh data - this is initial load
      this.log("No cache found, fetching fresh data");
      const items = await this.fetchFreshItems();
      return { items, isInitialLoad: true };
    } catch (error) {
      this.error("Failed to fetch items:", error);
      return { items: [], isInitialLoad: false };
    }
  }

  /**
   * Get cached items if they exist
   */
  private async getCachedItems(): Promise<{
    cached: T[] | null;
    isExpired: boolean;
  }> {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [this.config.cacheKey, this.cacheTimestampKey],
        (result) => {
          if (chrome.runtime.lastError) {
            resolve({ cached: null, isExpired: false });
            return;
          }

          const cachedItems = result[this.config.cacheKey];
          const timestamp = result[this.cacheTimestampKey];

          if (!cachedItems || !timestamp) {
            resolve({ cached: null, isExpired: false });
            return;
          }

          // Check if cache is still valid
          const now = Date.now();
          const age = now - timestamp;

          if (age > (this.config.cacheDuration || 0)) {
            this.log("Cache expired, but returning cached data");
            resolve({ cached: cachedItems, isExpired: true });
            return;
          }

          resolve({ cached: cachedItems, isExpired: false });
        }
      );
    });
  }

  /**
   * Fetch fresh items and update cache
   */
  public async fetchFreshItems(): Promise<T[]> {
    try {
      const url =
        typeof this.config.url === "function"
          ? await this.config.url()
          : this.config.url;

      // Try direct fetch first
      try {
        const response = await fetch(url, { redirect: "follow" });
        if (response.ok) {
          const data = await response.text();

          // Check if we got HTML instead of CSV
          if (data.trim().startsWith("<")) {
            this.error("Received HTML instead of CSV");
            return [];
          }

          const items = this.parseAndMap(data);

          // Cache the results
          if (items.length > 0) {
            await this.cacheItems(items);
          }
          return items;
        }
      } catch (fetchError) {
        this.log(
          "Direct fetch failed, trying background script:",
          fetchError
        );
      }

      // Fallback: Use background script to fetch
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "FETCH_CSV_LINKS", url },
          async (response) => {
            if (chrome.runtime.lastError) {
              this.error(
                "Error fetching via background:",
                chrome.runtime.lastError
              );
              resolve([]);
              return;
            }

            if (response?.success && response?.data) {
              // Check if we got HTML instead of CSV
              if (
                typeof response.data === "string" &&
                response.data.trim().startsWith("<")
              ) {
                this.error("Background received HTML instead of CSV");
                resolve([]);
                return;
              }

              const items = this.parseAndMap(response.data);
              if (items.length > 0) {
                await this.cacheItems(items);
              }
              resolve(items);
            } else {
              this.log("No data from background:", response);
              resolve([]);
            }
          }
        );
      });
    } catch (error) {
      this.error("Failed to fetch fresh items:", error);
      return [];
    }
  }

  /**
   * Parse CSV and map to items
   */
  private parseAndMap(csvText: string): T[] {
    const rows = parseCSV(csvText, this.config.csvParserOptions);
    const items: T[] = [];

    rows.forEach((row, index) => {
      const item = this.config.mapRow(row, index);
      if (item) {
        items.push(item);
      }
    });

    return items;
  }

  /**
   * Cache items in chrome.storage.local
   */
  private async cacheItems(items: T[]): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          [this.config.cacheKey]: items,
          [this.cacheTimestampKey]: Date.now(),
        },
        () => {
          if (chrome.runtime.lastError) {
            this.error("Failed to cache items:", chrome.runtime.lastError);
          }
          resolve();
        }
      );
    });
  }

  /**
   * Refresh items in the background
   */
  private refreshInBackground(): void {
    this.fetchFreshItems().catch((error) => {
      this.error("Background refresh failed:", error);
    });
  }

  /**
   * Clear the cache
   */
  public async clearCache(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.remove(
        [this.config.cacheKey, this.cacheTimestampKey],
        () => {
          if (chrome.runtime.lastError) {
            this.error("Failed to clear cache:", chrome.runtime.lastError);
          }
          resolve();
        }
      );
    });
  }
}

interface GoogleSheetRow {
  [key: string]: string;
}

/**
 * Robust CSV parser that handles standard CSVs and single-line Google Sheet exports.
 */
function parseCSV(
  csvText: string,
  options?: { expectedHeaders?: string[]; hasHeaders?: boolean }
): GoogleSheetRow[] {
  const text = (csvText || "").trim();
  if (!text) return [];

  // Tokenizer: splits by comma, respecting quotes
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (char === '"') {
        // Check for escaped quotes
        if (inQuotes && text[i+1] === '"') {
             current += '"';
             i++; // Skip next quote
        } else {
            inQuotes = !inQuotes;
        }
    } else if (char === "," && !inQuotes) {
      tokens.push(current.trim());
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
       if (current.length > 0 || text[i-1] === ',') {
           tokens.push(current.trim());
       }
       current = "";
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current.trim());

  // Determine headers
  let headers: string[] = [];
  let dataTokens = tokens;

  const hasHeaders = options?.hasHeaders !== false; // Default true

  if (hasHeaders) {
      // If headers are expected to be in the file
      if (options?.expectedHeaders && options.expectedHeaders.length > 0) {
          // Use expected headers length to slice
          // We assume the file HAS headers, so we consume the first N tokens
          const headerCount = options.expectedHeaders.length;
          // We can just use the tokens from file as headers, OR use expectedHeaders as keys
          // But if we use expectedHeaders as keys, we ignore the file's actual header row values
          // but we still need to CONSUME them from the token stream.
          
          // Let's verify if the first tokens look like headers?
          // For safety, let's just consume the first N tokens as headers.
          headers = tokens.slice(0, headerCount).map(h => h.replace(/^"|"$/g, ''));
          dataTokens = tokens.slice(headerCount);
      } else {
          // Auto-detect headers from first line
           const firstNewline = text.indexOf('\n');
           if (firstNewline !== -1) {
               // Parse just the first line to get headers
               const headerLine = text.substring(0, firstNewline);
               headers = parseCsvRow(headerLine); 
               
               // Slice tokens: we need to know how many tokens were in the first line.
               // This is tricky with the flat tokenizer.
               // So using the flat tokenizer for "header detection" is hard if we don't know the count.
               // BUT, headers.length tells us the column count!
               
               // Wait, if we parsed the first line independently, we know column count.
               // So we just start chunking tokens.
               // BUT we need to skip the header tokens in the flat list.
               // header tokens count = headers.length.
               
               dataTokens = tokens.slice(headers.length);
           } else {
               // Single line file. Assume headers are present? 
               // If we have no expectedHeaders, we are stuck.
               // Fallback: empty result or try to guess?
               return [];
           }
      }
  } else {
      // No headers in file. Use expectedHeaders or generate default.
      if (options?.expectedHeaders) {
          headers = options.expectedHeaders;
      } else {
          // No headers provided. Can't map.
          return [];
      }
      // Don't slice dataTokens, start from 0
  }

  if (headers.length === 0) return [];
  
  const result: GoogleSheetRow[] = [];
  const columnCount = headers.length;

  for (let i = 0; i < dataTokens.length; i += columnCount) {
      const rowTokens = dataTokens.slice(i, i + columnCount);
      
      // Skip partial rows at end
      if (rowTokens.length < columnCount) continue;

      // Check if all empty (sometimes happens with trailing commas/newlines)
      if (rowTokens.every(t => !t)) continue;

      const row: GoogleSheetRow = {};
      headers.forEach((h, idx) => {
          row[h] = rowTokens[idx] || "";
      });
      result.push(row);
  }

  return result;
}

/**
 * Simple row parser for header detection
 */
function parseCsvRow(row: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === ",") {
        out.push(current.trim());
        current = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        current += ch;
      }
    }
  }
  out.push(current.trim());
  return out.map(s => s.replace(/^"|"$/g, '').replace(/""/g, '"'));
}
