/**
 * Domain utilities for Chrome extension
 * Handles domain extraction, normalization, and matching
 */

/**
 * Extracts and normalizes a domain from a URL
 * @param url - The URL to extract domain from
 * @returns Normalized domain or null if invalid
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    let domain = urlObj.hostname.toLowerCase();

    // Handle special cases
    if (
      domain === "localhost" ||
      domain.startsWith("127.") ||
      domain.startsWith("192.168.")
    ) {
      return domain;
    }

    // Remove 'www.' prefix for consistency
    if (domain.startsWith("www.")) {
      domain = domain.substring(4);
    }

    return domain;
  } catch (error) {
    return null;
  }
}

/**
 * Checks if a domain matches a pattern (supports wildcards)
 * @param domain - The domain to check
 * @param pattern - The pattern to match against
 * @returns True if domain matches pattern
 */
export function matchesPattern(domain: string, pattern: string): boolean {
  if (!domain || !pattern) return false;

  const normalizedDomain = domain.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  // Exact match
  if (normalizedDomain === normalizedPattern) return true;

  // Wildcard pattern (e.g., *.example.com)
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.substring(2);
    return (
      normalizedDomain === suffix || normalizedDomain.endsWith("." + suffix)
    );
  }

  return false;
}

/**
 * Validates if a domain pattern is valid
 * @param pattern - The domain pattern to validate
 * @returns True if pattern is valid
 */
export function isValidDomainPattern(pattern: string): boolean {
  if (!pattern || typeof pattern !== "string") return false;

  const trimmed = pattern.trim();
  if (trimmed.length === 0) return false;

  // Check for valid domain characters and structure
  const domainRegex =
    /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;

  return domainRegex.test(trimmed);
}

/**
 * Gets the current tab's domain
 * @returns Promise that resolves to the current domain or null
 */
export async function getCurrentTabDomain(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          resolve(null);
          return;
        }

        const tab = tabs[0];
        if (!tab.url) {
          resolve(null);
          return;
        }

        const domain = extractDomain(tab.url);
        resolve(domain);
      });
    } catch (error) {
      resolve(null);
    }
  });
}

/**
 * Gets the current tab's full URL
 * @returns Promise that resolves to the current URL or null
 */
export async function getCurrentTabUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          resolve(null);
          return;
        }

        const tab = tabs[0];
        resolve(tab.url || null);
      });
    } catch (error) {
      resolve(null);
    }
  });
}
