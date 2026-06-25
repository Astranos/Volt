import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTopOfferResults,
  DEFAULT_CUSTOM_RATES,
  DEFAULT_ENABLED_OFFER_TYPES,
  migrateDefaultTopOfferRates,
  setBuiltInTopOfferEnabled,
  setBuiltInTopOfferStartingRatesEnabled,
  setCustomTopOfferStartingRatesEnabled,
  updateCustomTopOfferStartingDefaultPercentage,
  updateCustomTopOfferStartingRule,
  updateTopOfferStartingDefaultPercentage,
  updateTopOfferStartingRateRule,
} from "./top-offers.ts";

const LEGACY_CUSTOM_RATES = {
  standard: {
    rules: [
      { threshold: 50, percentage: 0.2 },
      { threshold: 100, percentage: 0.3 },
      { threshold: 250, percentage: 0.35 },
      { threshold: 500, percentage: 0.45 },
      { threshold: 750, percentage: 0.5 },
    ],
    defaultPercentage: 0.6,
  },
  premium: {
    rules: [
      { threshold: 50, percentage: 0.2 },
      { threshold: 100, percentage: 0.3 },
      { threshold: 200, percentage: 0.35 },
      { threshold: 250, percentage: 0.45 },
      { threshold: 500, percentage: 0.55 },
      { threshold: 750, percentage: 0.6 },
    ],
    defaultPercentage: 0.7,
  },
  checkout: {
    percentage: 0.8,
  },
};

test("calculateTopOfferResults follows the all-customer max cash guide", () => {
  assert.deepEqual(
    calculateTopOfferResults(600),
    {
      enabledOfferTypes: DEFAULT_ENABLED_OFFER_TYPES,
      startingOffer: 240,
      topOffer: 300,
      startingOfferPremium: 330,
      topOfferPremium: 360,
      startingOfferCheckout: 300,
      topOfferCheckout: 390,
      startingOfferNewCustomer: 300,
      topOfferNewCustomer: 360,
      customOffers: [],
    }
  );

  assert.deepEqual(
    calculateTopOfferResults(150),
    {
      enabledOfferTypes: DEFAULT_ENABLED_OFFER_TYPES,
      startingOffer: 35,
      topOffer: 45,
      startingOfferPremium: 35,
      topOfferPremium: 45,
      startingOfferCheckout: 45,
      topOfferCheckout: 95,
      startingOfferNewCustomer: 45,
      topOfferNewCustomer: 65,
      customOffers: [],
    }
  );
});

test("calculateTopOfferResults matches the Google Sheet top-offer row", () => {
  assert.deepEqual(
    calculateTopOfferResults(250),
    {
      enabledOfferTypes: DEFAULT_ENABLED_OFFER_TYPES,
      startingOffer: 75,
      topOffer: 100,
      startingOfferPremium: 110,
      topOfferPremium: 125,
      startingOfferCheckout: 100,
      topOfferCheckout: 160,
      startingOfferNewCustomer: 100,
      topOfferNewCustomer: 135,
      customOffers: [],
    }
  );
});

test("premium offer only goes above the guide for prices over 200", () => {
  assert.equal(calculateTopOfferResults(199).topOfferPremium, 55);
  assert.equal(calculateTopOfferResults(200).topOfferPremium, 100);
});

test("legacy default offer rates migrate to the current guide", () => {
  assert.deepEqual(migrateDefaultTopOfferRates(LEGACY_CUSTOM_RATES), DEFAULT_CUSTOM_RATES);
  assert.equal(
    calculateTopOfferResults(250, { customRates: LEGACY_CUSTOM_RATES }).topOffer,
    100
  );
  assert.equal(
    calculateTopOfferResults(250, { customRates: LEGACY_CUSTOM_RATES }).topOfferCheckout,
    160
  );
});

test("new customer max offer can be customized", () => {
  assert.equal(
    calculateTopOfferResults(250, {
      customRates: {
        ...DEFAULT_CUSTOM_RATES,
        newCustomer: {
          rules: [{ threshold: 500, percentage: 0.5 }],
          defaultPercentage: 0.75,
        },
      },
    }).topOfferNewCustomer,
    125
  );
});

test("built-in offer visibility can be disabled", () => {
  const settings = setBuiltInTopOfferEnabled(undefined, "premium", false);
  assert.deepEqual(calculateTopOfferResults(250, settings).enabledOfferTypes, {
    ...DEFAULT_ENABLED_OFFER_TYPES,
    premium: false,
  });
});

test("built-in starting offer rates can be customized", () => {
  let settings = setBuiltInTopOfferStartingRatesEnabled(undefined, "standard", true);
  settings = updateTopOfferStartingRateRule(
    settings,
    "standard",
    0,
    "percentage",
    0.5
  );
  settings = updateTopOfferStartingDefaultPercentage(settings, "standard", 0.8);

  assert.equal(calculateTopOfferResults(40, settings).startingOffer, 20);
  assert.equal(calculateTopOfferResults(1000, settings).startingOffer, 800);
});

test("custom offers return configurable start and max values", () => {
  let settings = {
    customRates: DEFAULT_CUSTOM_RATES,
    customOffers: [
      {
        id: "custom-1",
        name: "Custom",
        rules: [{ threshold: 500, percentage: 0.5 }],
        defaultPercentage: 0.7,
      },
    ],
  };

  assert.deepEqual(calculateTopOfferResults(250, settings).customOffers[0], {
    id: "custom-1",
    name: "Custom",
    enabled: true,
    startingValue: 75,
    maxValue: 125,
    value: 125,
  });

  settings = setCustomTopOfferStartingRatesEnabled(settings, "custom-1", true);
  settings = updateCustomTopOfferStartingRule(
    settings,
    "custom-1",
    3,
    "percentage",
    0.2
  );
  settings = updateCustomTopOfferStartingDefaultPercentage(
    settings,
    "custom-1",
    0.3
  );

  assert.equal(
    calculateTopOfferResults(250, settings).customOffers[0].startingValue,
    50
  );
});

test("custom offer start follows customized standard start by default", () => {
  let settings = {
    customRates: DEFAULT_CUSTOM_RATES,
    customOffers: [
      {
        id: "custom-1",
        name: "Custom",
        rules: [{ threshold: 500, percentage: 0.5 }],
        defaultPercentage: 0.7,
      },
    ],
  };
  settings = setBuiltInTopOfferStartingRatesEnabled(settings, "standard", true);
  settings = updateTopOfferStartingRateRule(
    settings,
    "standard",
    3,
    "percentage",
    0.2
  );

  assert.equal(
    calculateTopOfferResults(250, settings).customOffers[0].startingValue,
    50
  );
});
