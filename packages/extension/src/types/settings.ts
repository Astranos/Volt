export interface RateRule {
  threshold: number;
  percentage: number;
}

export interface CustomOffer {
  id: string;
  name: string;
  rules: RateRule[];
  defaultPercentage: number;
}

export interface CustomRates {
  standard: {
    rules: RateRule[];
    defaultPercentage: number;
  };
  premium: {
    rules: RateRule[];
    defaultPercentage: number;
  };
  checkout?: {
    percentage: number;
  };
}

export interface TopOffersSettings {
  customRates?: CustomRates;
  customOffers?: CustomOffer[];
}

export interface CustomSearchProviderSettings {
  id: string;
  name: string;
  triggers: string[];
  searchUrl: string;
  color: string;
}

export interface CmdkSettings {
  enabledSources: {
    tabs: boolean;
    bookmarks: boolean;
    history: boolean;
    quickLinks: boolean;
    tools: boolean;
    searchProviders: boolean;
  };
  sourceOrder: string[];
  enabledSearchProviders: Record<string, boolean>;
  customSearchProviders: CustomSearchProviderSettings[];
  shopifyButtons?: {
    enabled?: boolean;
  };
  newTabOverride?: {
    enabled?: boolean;
  };
  ebaySummary?: {
    enabled?: boolean;
  };
  upcHighlighter?: {
    enabled?: boolean;
  };
  csvLinks?: {
    customUrl?: string;
  };
  contextMenu?: {
    enabled?: boolean;
  };
  bookmarkFolderIds?: string[];
  topOffers?: TopOffersSettings;
}

export interface SyncStorageResult {
  cmdkSettings?: CmdkSettings;
}

export interface SyncStorageChanges {
  cmdkSettings?: {
    newValue?: CmdkSettings;
  };
}
