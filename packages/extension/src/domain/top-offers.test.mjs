import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTopOfferResults,
  DEFAULT_CUSTOM_RATES,
  migrateDefaultTopOfferRates,
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
