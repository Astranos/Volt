import type {
  CustomOffer,
  CustomRates,
  EnabledOfferTypes,
  OfferRateTable,
  RateRule,
  StartingRates,
  TopOffersSettings,
} from "../types/settings";

export const TOP_OFFER_FLOOR_MULTIPLE = 5;

export const DEFAULT_STANDARD_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.2 },
  { threshold: 100, percentage: 0.25 },
  { threshold: 200, percentage: 0.3 },
  { threshold: 500, percentage: 0.4 },
  { threshold: 750, percentage: 0.5 },
];

export const DEFAULT_STANDARD_DEFAULT_PERCENTAGE = 0.6;

export const DEFAULT_STANDARD_STARTING_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.1 },
  { threshold: 100, percentage: 0.2 },
  { threshold: 200, percentage: 0.25 },
  { threshold: 500, percentage: 0.3 },
  { threshold: 750, percentage: 0.4 },
];

export const DEFAULT_STANDARD_STARTING_DEFAULT_PERCENTAGE = 0.5;

export const DEFAULT_PREMIUM_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.2 },
  { threshold: 100, percentage: 0.25 },
  { threshold: 200, percentage: 0.3 },
  { threshold: 500, percentage: 0.5 },
  { threshold: 750, percentage: 0.6 },
];

export const DEFAULT_PREMIUM_DEFAULT_PERCENTAGE = 0.7;
export const DEFAULT_PREMIUM_STARTING_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.1 },
  { threshold: 100, percentage: 0.2 },
  { threshold: 200, percentage: 0.25 },
  { threshold: 500, percentage: 0.45 },
  { threshold: 750, percentage: 0.55 },
];

export const DEFAULT_PREMIUM_STARTING_DEFAULT_PERCENTAGE = 0.65;
export const DEFAULT_CHECKOUT_PERCENTAGE = 0.65;

export const DEFAULT_NEW_CUSTOMER_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.3 },
  { threshold: 100, percentage: 0.35 },
  { threshold: 250, percentage: 0.45 },
  { threshold: 500, percentage: 0.55 },
  { threshold: 750, percentage: 0.6 },
];

export const DEFAULT_NEW_CUSTOMER_DEFAULT_PERCENTAGE = 0.7;

const LEGACY_STANDARD_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.2 },
  { threshold: 100, percentage: 0.3 },
  { threshold: 250, percentage: 0.35 },
  { threshold: 500, percentage: 0.45 },
  { threshold: 750, percentage: 0.5 },
];

const LEGACY_STANDARD_DEFAULT_PERCENTAGE = 0.6;

const LEGACY_PREMIUM_RULES: RateRule[] = [
  { threshold: 50, percentage: 0.2 },
  { threshold: 100, percentage: 0.3 },
  { threshold: 200, percentage: 0.35 },
  { threshold: 250, percentage: 0.45 },
  { threshold: 500, percentage: 0.55 },
  { threshold: 750, percentage: 0.6 },
];

const LEGACY_PREMIUM_DEFAULT_PERCENTAGE = 0.7;
const LEGACY_CHECKOUT_PERCENTAGE = 0.8;

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
  newCustomer: {
    rules: DEFAULT_NEW_CUSTOMER_RULES,
    defaultPercentage: DEFAULT_NEW_CUSTOMER_DEFAULT_PERCENTAGE,
  },
};

export const DEFAULT_STARTING_RATES: Required<StartingRates> = {
  standard: {
    rules: DEFAULT_STANDARD_STARTING_RULES,
    defaultPercentage: DEFAULT_STANDARD_STARTING_DEFAULT_PERCENTAGE,
  },
  premium: {
    rules: DEFAULT_PREMIUM_STARTING_RULES,
    defaultPercentage: DEFAULT_PREMIUM_STARTING_DEFAULT_PERCENTAGE,
  },
  checkout: {
    rules: DEFAULT_STANDARD_RULES,
    defaultPercentage: DEFAULT_STANDARD_DEFAULT_PERCENTAGE,
  },
  newCustomer: {
    rules: DEFAULT_STANDARD_RULES,
    defaultPercentage: DEFAULT_STANDARD_DEFAULT_PERCENTAGE,
  },
};

export const DEFAULT_ENABLED_OFFER_TYPES: EnabledOfferTypes = {
  standard: true,
  premium: true,
  checkout: true,
  newCustomer: true,
};

export const DEFAULT_TOP_OFFERS_SETTINGS: TopOffersSettings = {
  customRates: DEFAULT_CUSTOM_RATES,
  customOffers: [],
  enabledOfferTypes: DEFAULT_ENABLED_OFFER_TYPES,
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
    enabled: true,
  };
}

function cloneRateTable(table: OfferRateTable): OfferRateTable {
  return {
    ...table,
    rules: [...table.rules],
  };
}

function rulesEqual(a: RateRule[] | undefined, b: RateRule[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every(
    (rule, index) =>
      rule.threshold === b[index].threshold &&
      Math.abs(rule.percentage - b[index].percentage) < 0.001
  );
}

export function migrateDefaultTopOfferRates(customRates?: CustomRates): CustomRates {
  if (!customRates) return DEFAULT_CUSTOM_RATES;

  const isLegacyStandard =
    rulesEqual(customRates.standard?.rules, LEGACY_STANDARD_RULES) &&
    Math.abs(
      customRates.standard.defaultPercentage - LEGACY_STANDARD_DEFAULT_PERCENTAGE
    ) < 0.001;
  const isLegacyPremium =
    rulesEqual(customRates.premium?.rules, LEGACY_PREMIUM_RULES) &&
    Math.abs(
      customRates.premium.defaultPercentage - LEGACY_PREMIUM_DEFAULT_PERCENTAGE
    ) < 0.001;
  const isLegacyCheckoutDefault =
    Math.abs(
      (customRates.checkout?.percentage ?? LEGACY_CHECKOUT_PERCENTAGE) -
        LEGACY_CHECKOUT_PERCENTAGE
    ) < 0.001;

  return {
    ...customRates,
    standard: isLegacyStandard ? DEFAULT_CUSTOM_RATES.standard : customRates.standard,
    premium: isLegacyPremium ? DEFAULT_CUSTOM_RATES.premium : customRates.premium,
    checkout: isLegacyCheckoutDefault
      ? DEFAULT_CUSTOM_RATES.checkout
      : customRates.checkout ?? DEFAULT_CUSTOM_RATES.checkout,
    newCustomer: customRates.newCustomer ?? DEFAULT_CUSTOM_RATES.newCustomer,
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

export function calculateStartingOffer(
  projection: number,
  startingRates?: StartingRates
): number {
  const rates = startingRates?.standard ?? DEFAULT_STARTING_RATES.standard;
  return calculateFromRules(projection, rates.rules, rates.defaultPercentage);
}

export function calculateStartingOfferPremium(
  projection: number,
  startingRates?: StartingRates
): number {
  const rates = startingRates?.premium ?? DEFAULT_STARTING_RATES.premium;
  return calculateFromRules(projection, rates.rules, rates.defaultPercentage);
}

export function calculateTopOfferCheckout(projection: number, customRates?: CustomRates): number {
  const checkoutRate = customRates?.checkout?.percentage ?? DEFAULT_CHECKOUT_PERCENTAGE;
  return floorToMultiple(projection * checkoutRate);
}

export function calculateStartingOfferCheckout(
  projection: number,
  customRates?: CustomRates,
  startingRates?: StartingRates
): number {
  if (startingRates?.checkout) {
    return calculateFromRules(
      projection,
      startingRates.checkout.rules,
      startingRates.checkout.defaultPercentage
    );
  }
  return calculateTopOffer(projection, customRates);
}

export function calculateTopOfferNewCustomer(projection: number, customRates?: CustomRates): number {
  const rates = customRates ?? DEFAULT_CUSTOM_RATES;
  const newCustomerRates = rates.newCustomer ?? DEFAULT_CUSTOM_RATES.newCustomer!;
  return calculateFromRules(
    projection,
    newCustomerRates.rules,
    newCustomerRates.defaultPercentage
  );
}

export function calculateStartingOfferNewCustomer(
  projection: number,
  customRates?: CustomRates,
  startingRates?: StartingRates
): number {
  if (startingRates?.newCustomer) {
    return calculateFromRules(
      projection,
      startingRates.newCustomer.rules,
      startingRates.newCustomer.defaultPercentage
    );
  }
  return calculateTopOffer(projection, customRates);
}

export function calculateCustomOffer(projection: number, offer: CustomOffer): number {
  return calculateFromRules(projection, offer.rules, offer.defaultPercentage);
}

export function calculateCustomStartingOffer(
  projection: number,
  offer: CustomOffer,
  startingRates?: StartingRates
): number {
  if (offer.startingRules) {
    return calculateFromRules(
      projection,
      offer.startingRules,
      offer.startingDefaultPercentage ??
        DEFAULT_STARTING_RATES.standard.defaultPercentage
    );
  }
  return calculateStartingOffer(projection, startingRates);
}

export function calculateTopOfferResults(projection: number, settings: TopOffersSettings = {}) {
  const customRates = migrateDefaultTopOfferRates(settings.customRates);
  const customOffers = settings.customOffers ?? [];
  const startingRates = settings.startingRates ?? {};
  const enabledOfferTypes = {
    ...DEFAULT_ENABLED_OFFER_TYPES,
    ...(settings.enabledOfferTypes || {}),
  };

  return {
    enabledOfferTypes,
    startingOffer: calculateStartingOffer(projection, startingRates),
    topOffer: calculateTopOffer(projection, customRates),
    startingOfferPremium: calculateStartingOfferPremium(projection, startingRates),
    topOfferPremium: calculateTopOfferPremium(projection, customRates),
    startingOfferCheckout: calculateStartingOfferCheckout(
      projection,
      customRates,
      startingRates
    ),
    topOfferCheckout: calculateTopOfferCheckout(projection, customRates),
    startingOfferNewCustomer: calculateStartingOfferNewCustomer(
      projection,
      customRates,
      startingRates
    ),
    topOfferNewCustomer: calculateTopOfferNewCustomer(projection, customRates),
    customOffers: customOffers.map((offer) => {
      const maxValue = calculateCustomOffer(projection, offer);
      return {
        id: offer.id,
        name: offer.name,
        enabled: offer.enabled ?? true,
        startingValue: calculateCustomStartingOffer(
          projection,
          offer,
          startingRates
        ),
        maxValue,
        value: maxValue,
      };
    }),
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

export type BuiltInTopOfferRateType = "standard" | "premium" | "newCustomer";
export type BuiltInTopOfferType = BuiltInTopOfferRateType | "checkout";
export type BuiltInStartingRateType = keyof StartingRates;

type NormalizedCustomRates = {
  standard: OfferRateTable;
  premium: OfferRateTable;
  checkout: {
    percentage: number;
  };
  newCustomer: OfferRateTable;
};

function normalizeTopOffersSettings(
  settings: TopOffersSettings = {}
): Required<Omit<TopOffersSettings, "startingRates">> & {
  customRates: NormalizedCustomRates;
  startingRates: StartingRates;
} {
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
      newCustomer: {
        ...DEFAULT_CUSTOM_RATES.newCustomer!,
        ...(customRates.newCustomer || {}),
        rules: [
          ...(customRates.newCustomer?.rules || DEFAULT_NEW_CUSTOMER_RULES),
        ],
        defaultPercentage:
          customRates.newCustomer?.defaultPercentage ??
          DEFAULT_NEW_CUSTOMER_DEFAULT_PERCENTAGE,
      },
    },
    startingRates: {
      ...(settings.startingRates || {}),
      standard: settings.startingRates?.standard
        ? cloneRateTable(settings.startingRates.standard)
        : undefined,
      premium: settings.startingRates?.premium
        ? cloneRateTable(settings.startingRates.premium)
        : undefined,
      checkout: settings.startingRates?.checkout
        ? cloneRateTable(settings.startingRates.checkout)
        : undefined,
      newCustomer: settings.startingRates?.newCustomer
        ? cloneRateTable(settings.startingRates.newCustomer)
        : undefined,
    },
    customOffers: (settings.customOffers || []).map((offer) => ({
      ...offer,
      enabled: offer.enabled ?? true,
      rules: [...offer.rules],
      startingRules: offer.startingRules ? [...offer.startingRules] : undefined,
    })),
    enabledOfferTypes: {
      ...DEFAULT_ENABLED_OFFER_TYPES,
      ...(settings.enabledOfferTypes || {}),
    },
  };
}

function getDefaultStartingRateTable(
  type: BuiltInStartingRateType,
  customRates: NormalizedCustomRates
): OfferRateTable {
  if (type === "checkout" || type === "newCustomer") {
    return cloneRateTable(customRates.standard);
  }
  return cloneRateTable(DEFAULT_STARTING_RATES[type]);
}

function getStartingRateTable(
  settings: ReturnType<typeof normalizeTopOffersSettings>,
  type: BuiltInStartingRateType
): OfferRateTable {
  return settings.startingRates[type]
    ? cloneRateTable(settings.startingRates[type]!)
    : getDefaultStartingRateTable(type, settings.customRates);
}

export function setBuiltInTopOfferEnabled(
  settings: TopOffersSettings | undefined,
  type: BuiltInTopOfferType,
  enabled: boolean
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.enabledOfferTypes = {
    ...next.enabledOfferTypes,
    [type]: enabled,
  };
  return next;
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

export function setBuiltInTopOfferStartingRatesEnabled(
  settings: TopOffersSettings | undefined,
  type: BuiltInStartingRateType,
  enabled: boolean
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const startingRates = { ...next.startingRates };
  if (enabled) {
    startingRates[type] = getStartingRateTable(next, type);
  } else {
    delete startingRates[type];
  }
  next.startingRates = startingRates;
  return next;
}

export function updateTopOfferStartingRateRule(
  settings: TopOffersSettings | undefined,
  type: BuiltInStartingRateType,
  index: number,
  field: keyof RateRule,
  value: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const currentRates = getStartingRateTable(next, type);
  const rules = [...currentRates.rules];
  if (!rules[index]) return next;

  rules[index] = { ...rules[index], [field]: value };
  next.startingRates = {
    ...next.startingRates,
    [type]: { ...currentRates, rules },
  };
  return next;
}

export function sortTopOfferStartingRateRules(
  settings: TopOffersSettings | undefined,
  type: BuiltInStartingRateType
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const currentRates = getStartingRateTable(next, type);
  next.startingRates = {
    ...next.startingRates,
    [type]: { ...currentRates, rules: sortRateRules(currentRates.rules) },
  };
  return next;
}

export function addTopOfferStartingRateRule(
  settings: TopOffersSettings | undefined,
  type: BuiltInStartingRateType
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const currentRates = getStartingRateTable(next, type);
  next.startingRates = {
    ...next.startingRates,
    [type]: {
      ...currentRates,
      rules: sortRateRules([
        ...currentRates.rules,
        createNextRateRule(currentRates.rules),
      ]),
    },
  };
  return next;
}

export function removeTopOfferStartingRateRule(
  settings: TopOffersSettings | undefined,
  type: BuiltInStartingRateType,
  index: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const currentRates = getStartingRateTable(next, type);
  next.startingRates = {
    ...next.startingRates,
    [type]: {
      ...currentRates,
      rules: currentRates.rules.filter((_, ruleIndex) => ruleIndex !== index),
    },
  };
  return next;
}

export function updateTopOfferStartingDefaultPercentage(
  settings: TopOffersSettings | undefined,
  type: BuiltInStartingRateType,
  value: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const currentRates = getStartingRateTable(next, type);
  next.startingRates = {
    ...next.startingRates,
    [type]: { ...currentRates, defaultPercentage: value },
  };
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

export function setCustomTopOfferEnabled(
  settings: TopOffersSettings | undefined,
  offerId: string,
  enabled: boolean
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  next.customOffers = next.customOffers.map((offer) =>
    offer.id === offerId ? { ...offer, enabled } : offer
  );
  return next;
}

export function setCustomTopOfferStartingRatesEnabled(
  settings: TopOffersSettings | undefined,
  offerId: string,
  enabled: boolean
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const standardStartRates = getStartingRateTable(next, "standard");
  next.customOffers = next.customOffers.map((offer) => {
    if (offer.id !== offerId) return offer;
    if (!enabled) {
      const { startingRules: _rules, startingDefaultPercentage: _default, ...rest } = offer;
      return rest;
    }
    return {
      ...offer,
      startingRules: offer.startingRules
        ? [...offer.startingRules]
        : [...standardStartRates.rules],
      startingDefaultPercentage:
        offer.startingDefaultPercentage ??
        standardStartRates.defaultPercentage,
    };
  });
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

export function updateCustomTopOfferStartingRule(
  settings: TopOffersSettings | undefined,
  offerId: string,
  ruleIndex: number,
  field: keyof RateRule,
  value: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const standardStartRates = getStartingRateTable(next, "standard");
  next.customOffers = next.customOffers.map((offer) => {
    if (offer.id !== offerId) return offer;
    const rules = offer.startingRules
      ? [...offer.startingRules]
      : [...standardStartRates.rules];
    if (!rules[ruleIndex]) return offer;
    rules[ruleIndex] = { ...rules[ruleIndex], [field]: value };
    return {
      ...offer,
      startingRules: rules,
      startingDefaultPercentage:
        offer.startingDefaultPercentage ??
        standardStartRates.defaultPercentage,
    };
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

export function sortCustomTopOfferStartingRules(
  settings: TopOffersSettings | undefined,
  offerId: string
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const standardStartRates = getStartingRateTable(next, "standard");
  next.customOffers = next.customOffers.map((offer) => {
    if (offer.id !== offerId) return offer;
    const rules = offer.startingRules
      ? [...offer.startingRules]
      : [...standardStartRates.rules];
    return {
      ...offer,
      startingRules: sortRateRules(rules),
      startingDefaultPercentage:
        offer.startingDefaultPercentage ??
        standardStartRates.defaultPercentage,
    };
  });
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

export function addCustomTopOfferStartingRule(
  settings: TopOffersSettings | undefined,
  offerId: string
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const standardStartRates = getStartingRateTable(next, "standard");
  next.customOffers = next.customOffers.map((offer) => {
    if (offer.id !== offerId) return offer;
    const rules = offer.startingRules
      ? [...offer.startingRules]
      : [...standardStartRates.rules];
    return {
      ...offer,
      startingRules: sortRateRules([...rules, createNextRateRule(rules)]),
      startingDefaultPercentage:
        offer.startingDefaultPercentage ??
        standardStartRates.defaultPercentage,
    };
  });
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

export function removeCustomTopOfferStartingRule(
  settings: TopOffersSettings | undefined,
  offerId: string,
  ruleIndex: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const standardStartRates = getStartingRateTable(next, "standard");
  next.customOffers = next.customOffers.map((offer) => {
    if (offer.id !== offerId) return offer;
    const rules = offer.startingRules
      ? [...offer.startingRules]
      : [...standardStartRates.rules];
    return {
      ...offer,
      startingRules: rules.filter((_, index) => index !== ruleIndex),
      startingDefaultPercentage:
        offer.startingDefaultPercentage ??
        standardStartRates.defaultPercentage,
    };
  });
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

export function updateCustomTopOfferStartingDefaultPercentage(
  settings: TopOffersSettings | undefined,
  offerId: string,
  value: number
): TopOffersSettings {
  const next = normalizeTopOffersSettings(settings);
  const standardStartRates = getStartingRateTable(next, "standard");
  next.customOffers = next.customOffers.map((offer) =>
    offer.id === offerId
      ? {
          ...offer,
          startingRules: offer.startingRules
            ? [...offer.startingRules]
            : [...standardStartRates.rules],
          startingDefaultPercentage: value,
        }
      : offer
  );
  return next;
}
