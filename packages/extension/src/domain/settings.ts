import type { CmdkSettings } from "../types/settings";
import {
  DEFAULT_TOP_OFFERS_SETTINGS,
  migrateDefaultTopOfferRates,
} from "./top-offers";

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
    scout: true,
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
  ebaySummary: {
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

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    enabledSources: {
      ...DEFAULT_SETTINGS.enabledSources,
      ...(stored.enabledSources || {}),
    },
    sourceOrder: mergedSourceOrder,
    enabledSearchProviders: {
      ...DEFAULT_SETTINGS.enabledSearchProviders,
      ...(stored.enabledSearchProviders || {}),
    },
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
    ebaySummary: {
      ...(DEFAULT_SETTINGS.ebaySummary || {}),
      ...(stored.ebaySummary || {}),
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
      },
      customOffers: stored.topOffers?.customOffers
        ? [...stored.topOffers.customOffers]
        : [...(DEFAULT_SETTINGS.topOffers?.customOffers || [])],
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
    ebaySummary: { ...(settings.ebaySummary || {}) },
    upcHighlighter: { ...(settings.upcHighlighter || {}) },
    csvLinks: { ...(settings.csvLinks || {}) },
    contextMenu: { ...(settings.contextMenu || {}) },
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
          }
        : undefined,
      customOffers: (settings.topOffers?.customOffers || []).map((offer) => ({
        ...offer,
        rules: [...offer.rules],
      })),
    },
  };
}
