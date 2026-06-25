export interface RateRule {
  threshold: number;
  percentage: number;
}

export interface OfferRateTable {
  rules: RateRule[];
  defaultPercentage: number;
}

export interface CustomOffer {
  id: string;
  name: string;
  rules: RateRule[];
  defaultPercentage: number;
  enabled?: boolean;
  startingRules?: RateRule[];
  startingDefaultPercentage?: number;
}

export interface CustomRates {
  standard: OfferRateTable;
  premium: OfferRateTable;
  checkout?: {
    percentage: number;
  };
  newCustomer?: OfferRateTable;
}

export interface StartingRates {
  standard?: OfferRateTable;
  premium?: OfferRateTable;
  checkout?: OfferRateTable;
  newCustomer?: OfferRateTable;
}

export interface EnabledOfferTypes {
  standard: boolean;
  premium: boolean;
  checkout: boolean;
  newCustomer: boolean;
}

export interface TopOffersSettings {
  customRates?: CustomRates;
  startingRates?: StartingRates;
  customOffers?: CustomOffer[];
  enabledOfferTypes?: EnabledOfferTypes;
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
  soldListingWarning?: {
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
  mobilePhotoDownloads?: {
    autoDeleteEnabled?: boolean;
    retentionHours?: number;
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
