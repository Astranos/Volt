import type { CmdkSettings } from "../types/settings";
import {
  DEFAULT_ENABLED_OFFER_TYPES,
  DEFAULT_TOP_OFFERS_SETTINGS,
  migrateDefaultTopOfferRates,
} from "./top-offers";

function cloneRateTable<T extends { rules: Array<unknown> }>(table: T): T {
  return {
    ...table,
    rules: [...table.rules],
  };
}

export const DEFAULT_SETTINGS: CmdkSettings = {
  enabledSources: {
    tabs: true,
    bookmarks: true,
    history: true,
    quickLinks: true,
    tools: true,
    searchProviders: true,
  },
  sourceOrder: [
    "tabs",
    "quickLinks",
    "bookmarks",
    "tools",
    "searchProviders",
    "history",
  ],
  enabledSearchProviders: {
    google: true,
    volt: true,
    amazon: true,
    bestbuy: true,
    ebay: true,
    pricecharting: true,
    barcodelookup: true,
    upcitemdb: true,
    youtube: true,
    github: true,
    twitter: true,
    homedepot: true,
    lowes: true,
    menards: true,
    microcenter: true,
  },
  customSearchProviders: [],
  shopifyButtons: {
    enabled: true,
  },
  newTabOverride: {
    enabled: true,
  },
  bookmarkFolderIds: [],
  soldListingWarning: {
    enabled: true,
  },
  upcHighlighter: {
    enabled: true,
  },
  csvLinks: {
    customUrl: "",
  },
  contextMenu: {
    enabled: true,
  },
  mobilePhotoDownloads: {
    autoDeleteEnabled: true,
    retentionHours: 24,
  },
  topOffers: DEFAULT_TOP_OFFERS_SETTINGS,
};

export const ALL_SOURCE_KEYS = [...DEFAULT_SETTINGS.sourceOrder];

export function mergeSettings(stored?: Partial<CmdkSettings>): CmdkSettings {
  if (!stored) {
    return structuredCloneSettings(DEFAULT_SETTINGS);
  }

  const sanitizedOrder = Array.isArray(stored.sourceOrder)
    ? stored.sourceOrder.filter((key) => ALL_SOURCE_KEYS.includes(key))
    : [];
  const mergedSourceOrder = [...sanitizedOrder];
  for (const key of ALL_SOURCE_KEYS) {
    if (!mergedSourceOrder.includes(key)) {
      mergedSourceOrder.push(key);
    }
  }

  const customRates = migrateDefaultTopOfferRates(stored.topOffers?.customRates);

  const enabledSearchProviders = {
    ...DEFAULT_SETTINGS.enabledSearchProviders,
    ...(stored.enabledSearchProviders || {}),
  };

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    enabledSources: {
      ...DEFAULT_SETTINGS.enabledSources,
      ...(stored.enabledSources || {}),
    },
    sourceOrder: mergedSourceOrder,
    enabledSearchProviders,
    customSearchProviders: stored.customSearchProviders
      ? [...stored.customSearchProviders]
      : [...DEFAULT_SETTINGS.customSearchProviders],
    shopifyButtons: {
      ...(DEFAULT_SETTINGS.shopifyButtons || {}),
      ...(stored.shopifyButtons || {}),
    },
    newTabOverride: {
      ...(DEFAULT_SETTINGS.newTabOverride || {}),
      ...(stored.newTabOverride || {}),
    },
    bookmarkFolderIds: stored.bookmarkFolderIds
      ? [...stored.bookmarkFolderIds]
      : [...(DEFAULT_SETTINGS.bookmarkFolderIds || [])],
    soldListingWarning: {
      ...(DEFAULT_SETTINGS.soldListingWarning || {}),
      ...(stored.soldListingWarning || {}),
    },
    upcHighlighter: {
      ...(DEFAULT_SETTINGS.upcHighlighter || {}),
      ...(stored.upcHighlighter || {}),
    },
    csvLinks: {
      ...(DEFAULT_SETTINGS.csvLinks || {}),
      ...(stored.csvLinks || {}),
    },
    contextMenu: {
      ...(DEFAULT_SETTINGS.contextMenu || {}),
      ...(stored.contextMenu || {}),
    },
    mobilePhotoDownloads: {
      ...(DEFAULT_SETTINGS.mobilePhotoDownloads || {}),
      ...(stored.mobilePhotoDownloads || {}),
      retentionHours:
        typeof stored.mobilePhotoDownloads?.retentionHours === "number" &&
        Number.isFinite(stored.mobilePhotoDownloads.retentionHours) &&
        stored.mobilePhotoDownloads.retentionHours > 0
          ? stored.mobilePhotoDownloads.retentionHours
          : DEFAULT_SETTINGS.mobilePhotoDownloads!.retentionHours,
    },
    topOffers: {
      ...(DEFAULT_SETTINGS.topOffers || {}),
      ...(stored.topOffers || {}),
      customRates: {
        standard: {
          ...DEFAULT_SETTINGS.topOffers!.customRates!.standard,
          ...customRates.standard,
          rules:
            customRates.standard.rules ||
            DEFAULT_SETTINGS.topOffers!.customRates!.standard.rules,
        },
        premium: {
          ...DEFAULT_SETTINGS.topOffers!.customRates!.premium,
          ...customRates.premium,
          rules:
            customRates.premium.rules ||
            DEFAULT_SETTINGS.topOffers!.customRates!.premium.rules,
        },
        checkout: {
          ...(DEFAULT_SETTINGS.topOffers!.customRates!.checkout || {}),
          ...(customRates.checkout || {}),
          percentage:
            customRates.checkout?.percentage ??
            DEFAULT_SETTINGS.topOffers!.customRates!.checkout!.percentage,
        },
        newCustomer: {
          ...DEFAULT_SETTINGS.topOffers!.customRates!.newCustomer!,
          ...(customRates.newCustomer || {}),
          rules:
            customRates.newCustomer?.rules ||
            DEFAULT_SETTINGS.topOffers!.customRates!.newCustomer!.rules,
        },
      },
      startingRates: {
        ...(stored.topOffers?.startingRates || {}),
        standard: stored.topOffers?.startingRates?.standard
          ? cloneRateTable(stored.topOffers.startingRates.standard)
          : undefined,
        premium: stored.topOffers?.startingRates?.premium
          ? cloneRateTable(stored.topOffers.startingRates.premium)
          : undefined,
        checkout: stored.topOffers?.startingRates?.checkout
          ? cloneRateTable(stored.topOffers.startingRates.checkout)
          : undefined,
        newCustomer: stored.topOffers?.startingRates?.newCustomer
          ? cloneRateTable(stored.topOffers.startingRates.newCustomer)
          : undefined,
      },
      customOffers: stored.topOffers?.customOffers
        ? stored.topOffers.customOffers.map((offer) => ({
            ...offer,
            enabled: offer.enabled ?? true,
            rules: [...offer.rules],
            startingRules: offer.startingRules
              ? [...offer.startingRules]
              : undefined,
          }))
        : [...(DEFAULT_SETTINGS.topOffers?.customOffers || [])],
      enabledOfferTypes: {
        ...DEFAULT_ENABLED_OFFER_TYPES,
        ...(stored.topOffers?.enabledOfferTypes || {}),
      },
    },
  };
}

export function structuredCloneSettings(settings: CmdkSettings): CmdkSettings {
  return {
    ...settings,
    enabledSources: { ...settings.enabledSources },
    sourceOrder: [...settings.sourceOrder],
    enabledSearchProviders: { ...settings.enabledSearchProviders },
    customSearchProviders: [...settings.customSearchProviders],
    bookmarkFolderIds: [...(settings.bookmarkFolderIds || [])],
    shopifyButtons: { ...(settings.shopifyButtons || {}) },
    newTabOverride: { ...(settings.newTabOverride || {}) },
    soldListingWarning: { ...(settings.soldListingWarning || {}) },
    upcHighlighter: { ...(settings.upcHighlighter || {}) },
    csvLinks: { ...(settings.csvLinks || {}) },
    contextMenu: { ...(settings.contextMenu || {}) },
    mobilePhotoDownloads: { ...(settings.mobilePhotoDownloads || {}) },
    topOffers: {
      ...(settings.topOffers || {}),
      customRates: settings.topOffers?.customRates
        ? {
            standard: {
              ...settings.topOffers.customRates.standard,
              rules: [...settings.topOffers.customRates.standard.rules],
            },
            premium: {
              ...settings.topOffers.customRates.premium,
              rules: [...settings.topOffers.customRates.premium.rules],
            },
            checkout: settings.topOffers.customRates.checkout
              ? { ...settings.topOffers.customRates.checkout }
              : undefined,
            newCustomer: settings.topOffers.customRates.newCustomer
              ? {
                  ...settings.topOffers.customRates.newCustomer,
                  rules: [...settings.topOffers.customRates.newCustomer.rules],
                }
              : undefined,
          }
        : undefined,
      startingRates: settings.topOffers?.startingRates
        ? {
            ...settings.topOffers.startingRates,
            standard: settings.topOffers.startingRates.standard
              ? cloneRateTable(settings.topOffers.startingRates.standard)
              : undefined,
            premium: settings.topOffers.startingRates.premium
              ? cloneRateTable(settings.topOffers.startingRates.premium)
              : undefined,
            checkout: settings.topOffers.startingRates.checkout
              ? cloneRateTable(settings.topOffers.startingRates.checkout)
              : undefined,
            newCustomer: settings.topOffers.startingRates.newCustomer
              ? cloneRateTable(settings.topOffers.startingRates.newCustomer)
              : undefined,
          }
        : undefined,
      customOffers: (settings.topOffers?.customOffers || []).map((offer) => ({
        ...offer,
        enabled: offer.enabled ?? true,
        rules: [...offer.rules],
        startingRules: offer.startingRules
          ? [...offer.startingRules]
          : undefined,
      })),
      enabledOfferTypes: {
        ...DEFAULT_ENABLED_OFFER_TYPES,
        ...(settings.topOffers?.enabledOfferTypes || {}),
      },
    },
  };
}
