/**
 * Generates a favicon URL for a given page URL using Chrome's internal favicon service.
 * Requires the 'favicon' permission in manifest.
 */
export function getFaviconUrl(pageUrl: string, size: number = 32): string {
  try {
    const url = new URL("/_favicon/", `chrome-extension://${chrome.runtime.id}`);
    url.searchParams.set("pageUrl", pageUrl);
    url.searchParams.set("size", size.toString());
    return url.toString();
  } catch (e) {
    // Fallback to a service if chrome.runtime is not available or other error
    try {
      const domain = new URL(pageUrl).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
    } catch (e2) {
      return "";
    }
  }
}

export function getDomainFaviconUrl(pageUrl: string, size: number = 32): string {
  try {
    const domain = new URL(pageUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
  } catch (e) {
    return "";
  }
}
