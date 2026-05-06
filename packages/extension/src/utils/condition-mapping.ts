/**
 * eBay Condition ID Mapping Utility
 *
 * Maps eBay condition IDs to Shopify condition values and vice versa.
 * Based on official eBay API documentation.
 */

export interface ConditionMapping {
  ebayId: number;
  ebayName: string;
  shopifyCondition: string;
}

// Complete eBay condition ID mapping
export const EBAY_CONDITION_MAP: Record<number, string> = {
  1000: "New",
  1500: "New other (see details)",
  1750: "New with defects",
  2000: "Certified Refurbished",
  2010: "Excellent - Refurbished",
  2020: "Very Good - Refurbished",
  2030: "Good - Refurbished",
  2500: "Seller refurbished",
  2750: "Like New",
  2990: "Pre-owned - Excellent",
  3000: "Used",
  3010: "Pre-owned - Fair",
  4000: "Very Good",
  5000: "Good",
  6000: "Acceptable",
  7000: "For Parts (not working)",
};

// Shopify to eBay condition mapping
// Maps standard Shopify conditions to acceptable eBay condition IDs
export const SHOPIFY_TO_EBAY_MAP: Record<string, number[]> = {
  "New": [1000, 1500, 1750],
  "new": [1000, 1500, 1750],
  "New other": [1500],
  "new other": [1500],
  "New other (see details)": [1500],
  "new other (see details)": [1500],
  "New with defects": [1750],
  "new with defects": [1750],
  "Refurbished": [2000, 2010, 2020, 2030, 2500],
  "refurbished": [2000, 2010, 2020, 2030, 2500],
  "Certified Refurbished": [2000],
  "certified refurbished": [2000],
  "Used": [2750, 2990, 3000, 3010, 4000, 5000, 6000],
  "used": [2750, 2990, 3000, 3010, 4000, 5000, 6000],
  "Pre-owned": [2750, 2990, 3000, 3010, 4000, 5000, 6000],
  "pre-owned": [2750, 2990, 3000, 3010, 4000, 5000, 6000],
  "Like New": [2750],
  "like new": [2750],
  "Damaged": [7000],
  "damaged": [7000],
  "For parts": [7000],
  "for parts": [7000],
  "For Parts (not working)": [7000],
  "for parts (not working)": [7000],
  "For parts or not working": [7000],
  "for parts or not working": [7000],
};

/**
 * Check if an eBay condition ID matches the Shopify condition
 */
export function isConditionMatch(
  shopifyCondition: string,
  ebayConditionId: number
): boolean {
  const normalizedShopify = shopifyCondition?.toLowerCase().trim();

  // Check direct mapping
  for (const [shopifyKey, ebayIds] of Object.entries(SHOPIFY_TO_EBAY_MAP)) {
    if (shopifyKey.toLowerCase() === normalizedShopify) {
      return ebayIds.includes(ebayConditionId);
    }
  }

  // Check partial matches for complex conditions
  if (normalizedShopify.includes("refurbish")) {
    return SHOPIFY_TO_EBAY_MAP["Refurbished"].includes(ebayConditionId);
  }

  if (normalizedShopify.includes("new")) {
    return SHOPIFY_TO_EBAY_MAP["New"].includes(ebayConditionId);
  }

  if (normalizedShopify.includes("used") || normalizedShopify.includes("pre-owned")) {
    return SHOPIFY_TO_EBAY_MAP["Used"].includes(ebayConditionId);
  }

  if (normalizedShopify.includes("parts") || normalizedShopify.includes("damaged")) {
    return SHOPIFY_TO_EBAY_MAP["Damaged"].includes(ebayConditionId);
  }

  return false;
}

/**
 * Get the eBay condition name from ID
 */
export function getEbayConditionName(ebayConditionId: number): string {
  return EBAY_CONDITION_MAP[ebayConditionId] || "Unknown";
}

/**
 * Get suggested eBay condition IDs for a Shopify condition
 */
export function getSuggestedEbayConditions(shopifyCondition: string): number[] {
  const normalizedShopify = shopifyCondition?.toLowerCase().trim();

  for (const [shopifyKey, ebayIds] of Object.entries(SHOPIFY_TO_EBAY_MAP)) {
    if (shopifyKey.toLowerCase() === normalizedShopify) {
      return ebayIds;
    }
  }

  // Partial match fallbacks
  if (normalizedShopify.includes("refurbish")) {
    return SHOPIFY_TO_EBAY_MAP["Refurbished"];
  }

  if (normalizedShopify.includes("new")) {
    return SHOPIFY_TO_EBAY_MAP["New"];
  }

  if (normalizedShopify.includes("used") || normalizedShopify.includes("pre-owned")) {
    return SHOPIFY_TO_EBAY_MAP["Used"];
  }

  if (normalizedShopify.includes("parts") || normalizedShopify.includes("damaged")) {
    return SHOPIFY_TO_EBAY_MAP["Damaged"];
  }

  return [];
}
