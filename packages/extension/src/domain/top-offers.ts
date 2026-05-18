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
