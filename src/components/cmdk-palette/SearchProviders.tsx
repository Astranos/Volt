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
    searchUrl: "https://www.google.com/search?q={query}",
    icon: Search,
    color: "bg-green-500",
  },
  {
    id: "scout",
    name: "Scout Search",
    trigger: ["scout", "search"],
    searchUrl: "https://google.com/search/?q={query}",
    icon: Store,
    color: "bg-green-700",
  },
  {
    id: "amazon",
    name: "Amazon",
    trigger: ["amazon", "ama", "amz"],
    searchUrl: "https://www.amazon.com/s?k={query}",
    icon: ShoppingCart,
    color: "bg-orange-500",
  },
  {
    id: "bestbuy",
    name: "Best Buy",
    trigger: ["bestbuy", "bb", "best"],
    searchUrl: "https://www.bestbuy.com/site/searchpage.jsp?st={query}",
    icon: ShoppingCart,
    color: "bg-yellow-500",
  },
  {
    id: "ebay",
    name: "eBay (Sold Prices)",
    trigger: ["ebay", "eb"],
    searchUrl:
      "https://www.ebay.com/sch/i.html?_nkw={query}&LH_Sold=1&LH_Complete=1&_dmd=2&rt=nc",
    icon: Tag,
    color: "bg-green-800",
  },
  {
    id: "pricecharting",
    name: "Price Charting",
    trigger: ["pricecharting", "pc", "price"],
    searchUrl:
      "https://www.pricecharting.com/search-products?q={query}&type=videogames",
    icon: TrendingUp,
    color: "bg-blue-600",
  },
  {
    id: "barcodelookup",
    name: "BarcodeLookup (UPC)",
    trigger: ["barcodelookup", "barcode"],
    searchUrl: "https://www.barcodelookup.com/{query}",
    icon: Barcode,
    color: "bg-gray-700",
  },
  {
    id: "upcitemdb",
    name: "UPCItemDB",
    trigger: ["upc", "upcitemdb", "barcode"],
    searchUrl: "https://www.upcitemdb.com/upc/{query}",
    icon: Barcode,
    color: "bg-gray-600",
  },
  {
    id: "youtube",
    name: "YouTube",
    trigger: ["youtube", "yt"],
    searchUrl: "https://www.youtube.com/results?search_query={query}",
    icon: Youtube,
    color: "bg-red-500",
  },
  {
    id: "github",
    name: "GitHub",
    trigger: ["github", "gh"],
    searchUrl: "https://github.com/search?q={query}",
    icon: Github,
    color: "bg-stone-800",
  },
  {
    id: "twitter",
    name: "Twitter/X",
    trigger: ["twitter", "x"],
    searchUrl: "https://twitter.com/search?q={query}",
    icon: MessageCircle,
    color: "bg-sky-500",
  },
  {
    id: "homedepot",
    name: "Home Depot",
    trigger: ["homedepot", "hd", "home"],
    searchUrl: "https://www.homedepot.com/s/{query}",
    icon: Home,
    color: "bg-orange-600",
  },
  {
    id: "lowes",
    name: "Lowe's",
    trigger: ["lowes", "low"],
    searchUrl: "https://www.lowes.com/search?searchTerm={query}",
    icon: Wrench,
    color: "bg-blue-500",
  },
  {
    id: "menards",
    name: "Menards",
    trigger: ["menards", "men"],
    searchUrl: "https://www.menards.com/main/search.html?search={query}",
    icon: PaintBucket,
    color: "bg-green-700",
  },
  {
    id: "microcenter",
    name: "Micro Center",
    trigger: ["microcenter", "micro", "mc"],
    searchUrl:
      "https://www.microcenter.com/search/search_results.aspx?N=&cat=&Ntt={query}",
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
