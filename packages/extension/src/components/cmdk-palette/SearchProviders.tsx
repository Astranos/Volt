import {
  Search,
  ShoppingCart,
  Youtube,
  Github,
  MessageCircle,
  Tag,
  Barcode,
  DollarSign,
  Store,
  TrendingUp,
  Home,
  Wrench,
  PaintBucket,
  Cpu,
  Globe,
} from "lucide-react";
import { SEARCH_URL_TEMPLATES } from "@/src/domain/search";

export interface SearchProvider {
  id: string;
  name: string;
  trigger: string[];
  searchUrl: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  // When true, provider will be excluded from the "switch providers" list
  hideInSwitcher?: boolean;
  isCustom?: boolean;
}

export interface CustomSearchProvider {
  id: string;
  name: string;
  triggers: string[];
  searchUrl: string;
  color: string;
}

export const searchProviders: SearchProvider[] = [
  {
    id: "google",
    name: "Google",
    trigger: ["google", "g"],
    searchUrl: SEARCH_URL_TEMPLATES.google,
    icon: Search,
    color: "bg-green-500",
  },
  {
    id: "scout",
    name: "Scout Search",
    trigger: ["scout", "search"],
    searchUrl: SEARCH_URL_TEMPLATES.scout,
    icon: Store,
    color: "bg-green-700",
  },
  {
    id: "amazon",
    name: "Amazon",
    trigger: ["amazon", "ama", "amz"],
    searchUrl: SEARCH_URL_TEMPLATES.amazon,
    icon: ShoppingCart,
    color: "bg-orange-500",
  },
  {
    id: "bestbuy",
    name: "Best Buy",
    trigger: ["bestbuy", "bb", "best"],
    searchUrl: SEARCH_URL_TEMPLATES.bestbuy,
    icon: ShoppingCart,
    color: "bg-yellow-500",
  },
  {
    id: "ebay",
    name: "eBay (Sold Prices)",
    trigger: ["ebay", "eb"],
    searchUrl: SEARCH_URL_TEMPLATES.ebay,
    icon: Tag,
    color: "bg-green-800",
  },
  {
    id: "pricecharting",
    name: "Price Charting",
    trigger: ["pricecharting", "pc", "price"],
    searchUrl: SEARCH_URL_TEMPLATES.pricecharting,
    icon: TrendingUp,
    color: "bg-blue-600",
  },
  {
    id: "barcodelookup",
    name: "BarcodeLookup (UPC)",
    trigger: ["barcodelookup", "barcode"],
    searchUrl: SEARCH_URL_TEMPLATES.barcodelookup,
    icon: Barcode,
    color: "bg-gray-700",
  },
  {
    id: "upcitemdb",
    name: "UPCItemDB",
    trigger: ["upc", "upcitemdb", "barcode"],
    searchUrl: SEARCH_URL_TEMPLATES.upcitemdb,
    icon: Barcode,
    color: "bg-gray-600",
  },
  {
    id: "youtube",
    name: "YouTube",
    trigger: ["youtube", "yt"],
    searchUrl: SEARCH_URL_TEMPLATES.youtube,
    icon: Youtube,
    color: "bg-red-500",
  },
  {
    id: "github",
    name: "GitHub",
    trigger: ["github", "gh"],
    searchUrl: SEARCH_URL_TEMPLATES.github,
    icon: Github,
    color: "bg-stone-800",
  },
  {
    id: "twitter",
    name: "Twitter/X",
    trigger: ["twitter", "x"],
    searchUrl: SEARCH_URL_TEMPLATES.twitter,
    icon: MessageCircle,
    color: "bg-sky-500",
  },
  {
    id: "homedepot",
    name: "Home Depot",
    trigger: ["homedepot", "hd", "home"],
    searchUrl: SEARCH_URL_TEMPLATES.homedepot,
    icon: Home,
    color: "bg-orange-600",
  },
  {
    id: "lowes",
    name: "Lowe's",
    trigger: ["lowes", "low"],
    searchUrl: SEARCH_URL_TEMPLATES.lowes,
    icon: Wrench,
    color: "bg-blue-500",
  },
  {
    id: "menards",
    name: "Menards",
    trigger: ["menards", "men"],
    searchUrl: SEARCH_URL_TEMPLATES.menards,
    icon: PaintBucket,
    color: "bg-green-700",
  },
  {
    id: "microcenter",
    name: "Micro Center",
    trigger: ["microcenter", "micro", "mc"],
    searchUrl: SEARCH_URL_TEMPLATES.microcenter,
    icon: Cpu,
    color: "bg-red-600",
  },
];

export function findProviderByTrigger(
  input: string,
  customProviders?: CustomSearchProvider[]
): SearchProvider | null {
  const lowerInput = input.toLowerCase().trim();

  // Check default providers
  for (const provider of searchProviders) {
    for (const trigger of provider.trigger) {
      if (trigger.startsWith(lowerInput) || lowerInput.startsWith(trigger)) {
        return provider;
      }
    }
  }

  // Check custom providers
  if (customProviders) {
    for (const customProvider of customProviders) {
      for (const trigger of customProvider.triggers) {
        if (trigger.startsWith(lowerInput) || lowerInput.startsWith(trigger)) {
          // Convert custom provider to SearchProvider format
          return {
            id: customProvider.id,
            name: customProvider.name,
            trigger: customProvider.triggers,
            searchUrl: customProvider.searchUrl,
            icon: Globe, // Default icon for custom providers
            color: customProvider.color,
            isCustom: true,
          };
        }
      }
    }
  }

  return null;
}

export function getAllSearchProviders(
  customProviders?: CustomSearchProvider[],
  enabledProviders?: { [providerId: string]: boolean }
): SearchProvider[] {
  // Filter default providers based on enabled status
  const filteredDefaultProviders = searchProviders.filter(
    (provider) => enabledProviders?.[provider.id] !== false
  );

  // Convert custom providers to SearchProvider format
  const convertedCustomProviders = (customProviders || [])
    .filter((provider) => enabledProviders?.[provider.id] !== false)
    .map((customProvider) => ({
      id: customProvider.id,
      name: customProvider.name,
      trigger: customProvider.triggers,
      searchUrl: customProvider.searchUrl,
      icon: Globe, // Default icon for custom providers
      color: customProvider.color,
      isCustom: true,
    }));

  return [...filteredDefaultProviders, ...convertedCustomProviders];
}
