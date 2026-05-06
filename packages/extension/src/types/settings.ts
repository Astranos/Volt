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

export interface CmdkSettings {
  newTabOverride?: {
    enabled?: boolean;
  };
  controllerTesting?: {
    lightThreshold?: number;
    mediumThreshold?: number;
    autoStart?: boolean;
  };
  ebaySummary?: {
    enabled?: boolean;
  };
  csvLinks?: {
    customUrl?: string;
  };
  toolbar?: {
    enabled?: boolean;
  };
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
