import assert from "node:assert/strict";
import test from "node:test";

import {
  CURSOR_DELIVERY_LEDGER_KEY,
  createCloudCursorDeliveryController,
} from "./cloud-cursor-delivery-controller.ts";

function createChromeStorage() {
  const values = {};
  return {
    chromeApi: {
      storage: {
        local: {
          async get(key) {
            return { [key]: values[key] };
          },
          async set(next) {
            Object.assign(values, next);
          },
        },
      },
    },
    values,
  };
}

function delivery(overrides = {}) {
  return {
    deliveryId: "delivery-1",
    resultId: "result-1",
    kind: "text",
    text: "hello",
    expiresAt: 2_000,
    ...overrides,
  };
}

test("expired cursor deliveries are failed without insertion and recorded", async () => {
  const { chromeApi, values } = createChromeStorage();
  const insertions = [];
  const acknowledgements = [];
  const controller = createCloudCursorDeliveryController({
    chromeApi,
    insertScannerText: async (...args) => {
      insertions.push(args);
      return true;
    },
    acknowledgeDelivery: async (...args) => acknowledgements.push(args),
    log: () => {},
    now: () => 3_000,
  });

  await controller.handleDeliveries([delivery()]);

  assert.deepEqual(insertions, []);
  assert.deepEqual(acknowledgements, [[
    "delivery-1",
    {
      state: "failed",
      errorCode: "expired",
      processedAt: 3_000,
      acknowledged: false,
    },
  ]]);
  assert.equal(values[CURSOR_DELIVERY_LEDGER_KEY]["delivery-1"].acknowledged, true);
});

test("clipboard fallback is failed as no editable field and never double-inserts", async () => {
  const { chromeApi } = createChromeStorage();
  let insertionCount = 0;
  const acknowledgements = [];
  const controller = createCloudCursorDeliveryController({
    chromeApi,
    insertScannerText: async () => {
      insertionCount += 1;
      return false;
    },
    acknowledgeDelivery: async (...args) => acknowledgements.push(args),
    log: () => {},
    now: () => 1_000,
  });

  await controller.handleDeliveries([delivery()]);
  await controller.handleDeliveries([delivery()]);

  assert.equal(insertionCount, 1);
  assert.equal(acknowledgements.length, 1);
  assert.equal(acknowledgements[0][1].state, "failed");
  assert.equal(acknowledgements[0][1].errorCode, "no-editable-field");
});

test("failed acknowledgements retry from the ledger without repeating insertion", async () => {
  const { chromeApi } = createChromeStorage();
  let insertionCount = 0;
  let acknowledgementCount = 0;
  const controller = createCloudCursorDeliveryController({
    chromeApi,
    insertScannerText: async () => {
      insertionCount += 1;
      return true;
    },
    acknowledgeDelivery: async () => {
      acknowledgementCount += 1;
      if (acknowledgementCount === 1) throw new Error("offline");
    },
    log: () => {},
    now: () => 1_000,
  });

  await controller.handleDeliveries([delivery()]);
  await controller.handleDeliveries([delivery()]);

  assert.equal(insertionCount, 1);
  assert.equal(acknowledgementCount, 2);
});
