import type { CustomOffer, CustomRates, RateRule, TopOffersSettings } from "../types/settings";

export const TOP_OFFER_FLOOR_MULTIPLE = 5;

export const DEFAULT_STANDARD_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.2 },
  { threshold: 100, percentage: 0.3 },
  { threshold: 250, percentage: 0.35 },
  { threshold: 500, percentage: 0.45 },
  { threshold: 750, percentage: 0.5 },
];

export const DEFAULT_STANDARD_DEFAULT_PERCENTAGE = 0.6;

export const DEFAULT_PREMIUM_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.2 },
  { threshold: 100, percentage: 0.3 },
  { threshold: 200, percentage: 0.35 },
  { threshold: 250, percentage: 0.45 },
  { threshold: 500, percentage: 0.55 },
  { threshold: 750, percentage: 0.6 },
];

export const DEFAULT_PREMIUM_DEFAULT_PERCENTAGE = 0.7;
export const DEFAULT_CHECKOUT_PERCENTAGE = 0.8;

export const DEFAULT_CUSTOM_RATES: CustomRates = {
  standard: {
    rules: DEFAULT_STANDARD_RULES,
    defaultPercentage: DEFAULT_STANDARD_DEFAULT_PERCENTAGE,
  },
  premium: {
    rules: DEFAULT_PREMIUM_RULES,
    defaultPercentage: DEFAULT_PREMIUM_DEFAULT_PERCENTAGE,
  },
  checkout: {
    percentage: DEFAULT_CHECKOUT_PERCENTAGE,
  },
};

export const DEFAULT_TOP_OFFERS_SETTINGS: TopOffersSettings = {
  customRates: DEFAULT_CUSTOM_RATES,
  customOffers: [],
};

export function floorToMultiple(value: number, multiple = TOP_OFFER_FLOOR_MULTIPLE): number {
  return Math.floor(value / multiple) * multiple;
}

export function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function sortRateRules(rules: RateRule[]): RateRule[] {
  return [...rules].sort((a, b) => a.threshold - b.threshold);
}

export function createNextRateRule(rules: RateRule[]): RateRule {
  const lastRule = rules[rules.length - 1];
  return lastRule
    ? { threshold: lastRule.threshold + 100, percentage: lastRule.percentage }
    : { threshold: 100, percentage: 0.2 };
}

export function createCustomOffer(id: string, name = "Custom Offer"): CustomOffer {
  return {
    id,
    name,
    rules: DEFAULT_STANDARD_RULES,
    defaultPercentage: DEFAULT_STANDARD_DEFAULT_PERCENTAGE,
  };
}

function calculateFromRules(projection: number, rules: RateRule[], defaultPercentage: number): number {
  for (const rule of rules) {
    if (projection < rule.threshold) {
      return floorToMultiple(projection * rule.percentage);
    }
  }

  return floorToMultiple(projection * defaultPercentage);
}

export function calculateTopOffer(projection: number, customRates?: CustomRates): number {
  const rates = customRates ?? DEFAULT_CUSTOM_RATES;
  return calculateFromRules(
    projection,
    rates.standard.rules,
    rates.standard.defaultPercentage
  );
}

export function calculateTopOfferPremium(projection: number, customRates?: CustomRates): number {
  const rates = customRates ?? DEFAULT_CUSTOM_RATES;
  return calculateFromRules(
    projection,
    rates.premium.rules,
    rates.premium.defaultPercentage
  );
}

export function calculateTopOfferCheckout(projection: number, customRates?: CustomRates): number {
  const checkoutRate = customRates?.checkout?.percentage ?? DEFAULT_CHECKOUT_PERCENTAGE;
  return floorToMultiple(projection * checkoutRate);
}

export function calculateCustomOffer(projection: number, offer: CustomOffer): number {
  return calculateFromRules(projection, offer.rules, offer.defaultPercentage);
}

export function calculateTopOfferResults(projection: number, settings: TopOffersSettings = {}) {
  const customRates = settings.customRates;
  const customOffers = settings.customOffers ?? [];

  return {
    topOffer: calculateTopOffer(projection, customRates),
    topOfferPremium: calculateTopOfferPremium(projection, customRates),
    topOfferCheckout: calculateTopOfferCheckout(projection, customRates),
    customOffers: customOffers.map((offer) => ({
      id: offer.id,
      name: offer.name,
      value: calculateCustomOffer(projection, offer),
    })),
  };
}

export function isStandardRateCustom(
  threshold: number | undefined,
  percentage: number,
  customRates?: CustomRates
): boolean {
  if (!customRates) return false;

  if (threshold === undefined) {
    return (
      Math.abs(
        customRates.standard.defaultPercentage -
          DEFAULT_STANDARD_DEFAULT_PERCENTAGE
      ) > 0.001
    );
  }

  const defaultRule = DEFAULT_STANDARD_RULES.find((rule) => rule.threshold === threshold);
  if (!defaultRule) return true;

  return Math.abs(defaultRule.percentage - percentage) > 0.001;
}

export function isPremiumRateCustom(
  threshold: number | undefined,
  percentage: number,
  customRates?: CustomRates
): boolean {
  if (!customRates) return false;

  if (threshold === undefined) {
    return (
      Math.abs(
        customRates.premium.defaultPercentage -
          DEFAULT_PREMIUM_DEFAULT_PERCENTAGE
      ) > 0.001
    );
  }

  const defaultRule = DEFAULT_PREMIUM_RULES.find((rule) => rule.threshold === threshold);
  if (!defaultRule) return true;

  return Math.abs(defaultRule.percentage - percentage) > 0.001;
}

export function isCheckoutRateCustom(customRates?: CustomRates): boolean {
  if (!customRates?.checkout) return false;
  return (
    Math.abs(customRates.checkout.percentage - DEFAULT_CHECKOUT_PERCENTAGE) >
    0.001
  );
}

export type BuiltInTopOfferRateType = "standard" | "premium";

function normalizeTopOffersSettings(
  settings: TopOffersSettings = {}
): Required<TopOffersSettings> & { customRates: CustomRates } {
  const customRates = settings.customRates ?? DEFAULT_CUSTOM_RATES;

  return {
    customRates: {
      standard: {
        ...DEFAULT_CUSTOM_RATES.standard,
        ...(customRates.standard || {}),
        rules: [...(customRates.standard?.rules || DEFAULT_STANDARD_RULES)],
      },
      premium: {
        ...DEFAULT_CUSTOM_RATES.premium,
        ...(customRates.premium || {}),
        rules: [...(customRates.premium?.rules || DEFAULT_PREMIUM_RULES)],
      },
      checkout: {
        ...DEFAULT_CUSTOM_RATES.checkout,
        ...(customRates.checkout || {}),
        percentage:
          customRates.checkout?.percentage ??
          DEFAULT_CUSTOM_RATES.checkout!.percentage,
      },
    },
    customOffers: (settings.customOffers || []).map((offer) => ({
      ...offer,
      rules: [...offer.rules],
    })),
  };
}

export function updateTopOfferRateRule(
  settings: TopOffersSettings | undefined,
  type: BuiltInTopOfferRateType,
  index: number,
  field: keyof RateRule,
  value: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const currentRates = next.customRates[type];
  const rules = [...currentRates.rules];
  if (!rules[index]) return next;

  rules[index] = { ...rules[index], [field]: value };
  next.customRates[type] = { ...currentRates, rules };
  return next;
}

export function sortTopOfferRateRules(
  settings: TopOffersSettings | undefined,
  type: BuiltInTopOfferRateType
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customRates[type] = {
    ...next.customRates[type],
    rules: sortRateRules(next.customRates[type].rules),
  };
  return next;
}

export function addTopOfferRateRule(
  settings: TopOffersSettings | undefined,
  type: BuiltInTopOfferRateType
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const currentRates = next.customRates[type];
  next.customRates[type] = {
    ...currentRates,
    rules: sortRateRules([
      ...currentRates.rules,
      createNextRateRule(currentRates.rules),
    ]),
  };
  return next;
}

export function removeTopOfferRateRule(
  settings: TopOffersSettings | undefined,
  type: BuiltInTopOfferRateType,
  index: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const currentRates = next.customRates[type];
  next.customRates[type] = {
    ...currentRates,
    rules: currentRates.rules.filter((_, ruleIndex) => ruleIndex !== index),
  };
  return next;
}

export function updateTopOfferDefaultPercentage(
  settings: TopOffersSettings | undefined,
  type: BuiltInTopOfferRateType,
  value: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customRates[type] = {
    ...next.customRates[type],
    defaultPercentage: value,
  };
  return next;
}

export function updateTopOfferCheckoutRate(
  settings: TopOffersSettings | undefined,
  value: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customRates.checkout = { percentage: value };
  return next;
}

export function addCustomTopOffer(
  settings: TopOffersSettings | undefined,
  id: string,
  name = "Custom Offer"
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customOffers = [...next.customOffers, createCustomOffer(id, name)];
  return next;
}

export function updateCustomTopOfferName(
  settings: TopOffersSettings | undefined,
  offerId: string,
  name: string
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customOffers = next.customOffers.map((offer) =>
    offer.id === offerId ? { ...offer, name } : offer
  );
  return next;
}

export function deleteCustomTopOffer(
  settings: TopOffersSettings | undefined,
  offerId: string
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customOffers = next.customOffers.filter((offer) => offer.id !== offerId);
  return next;
}

export function updateCustomTopOfferRule(
  settings: TopOffersSettings | undefined,
  offerId: string,
  ruleIndex: number,
  field: keyof RateRule,
  value: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customOffers = next.customOffers.map((offer) => {
    if (offer.id !== offerId || !offer.rules[ruleIndex]) return offer;
    const rules = [...offer.rules];
    rules[ruleIndex] = { ...rules[ruleIndex], [field]: value };
    return { ...offer, rules };
  });
  return next;
}

export function sortCustomTopOfferRules(
  settings: TopOffersSettings | undefined,
  offerId: string
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customOffers = next.customOffers.map((offer) =>
    offer.id === offerId ? { ...offer, rules: sortRateRules(offer.rules) } : offer
  );
  return next;
}

export function addCustomTopOfferRule(
  settings: TopOffersSettings | undefined,
  offerId: string
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customOffers = next.customOffers.map((offer) =>
    offer.id === offerId
      ? {
          ...offer,
          rules: sortRateRules([...offer.rules, createNextRateRule(offer.rules)]),
        }
      : offer
  );
  return next;
}

export function removeCustomTopOfferRule(
  settings: TopOffersSettings | undefined,
  offerId: string,
  ruleIndex: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customOffers = next.customOffers.map((offer) =>
    offer.id === offerId
      ? {
          ...offer,
          rules: offer.rules.filter((_, index) => index !== ruleIndex),
        }
      : offer
  );
  return next;
}

export function updateCustomTopOfferDefaultPercentage(
  settings: TopOffersSettings | undefined,
  offerId: string,
  value: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customOffers = next.customOffers.map((offer) =>
    offer.id === offerId ? { ...offer, defaultPercentage: value } : offer
  );
  return next;
}
