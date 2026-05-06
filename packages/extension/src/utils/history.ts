export interface HistoryItem {
  id: string;
  title: string;
  url: string;
  lastVisitTime?: number;
  visitCount?: number;
}

/**
 * Get recent browsing history from Chrome
 */
export async function getRecentHistory(maxResults = 50): Promise<HistoryItem[]> {
  return new Promise((resolve) => {
    chrome.history.search(
      {
        text: "",
        maxResults: maxResults,
        startTime: 0,
      },
      (historyItems) => {
        if (chrome.runtime.lastError) {
          console.error(
            "[History] Error getting history:",
            chrome.runtime.lastError
          );
          resolve([]);
          return;
        }

        const items: HistoryItem[] = historyItems.map((item) => ({
          id: item.id || item.url || String(Math.random()),
          title: item.title || "Untitled",
          url: item.url || "",
          lastVisitTime: item.lastVisitTime,
          visitCount: item.visitCount,
        }));

        console.log("[History] Found history items:", items.length);
        resolve(items);
      }
    );
  });
}

/**
 * Filter history items by search query
 */
export function filterHistory(
  historyItems: HistoryItem[],
  query: string
): HistoryItem[] {
  if (!query.trim()) return historyItems;

  const lowerQuery = query.toLowerCase();
  return historyItems.filter((item) => {
    const title = item.title?.toLowerCase() || "";
    const url = item.url?.toLowerCase() || "";

    return title.includes(lowerQuery) || url.includes(lowerQuery);
  });
}
