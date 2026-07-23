import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CURSOR_DELIVERY_LEDGER_KEY,
  CURSOR_DELIVERY_LEDGER_LIMIT,
  createCloudCursorDeliveryController,
} from "./cloud-cursor-delivery-controller.ts";

const controllerSource = readFileSync(
  new URL("./cloud-cursor-delivery-controller.ts", import.meta.url),
  "utf8",
);

function createChromeStorage(initialValues = {}, onSet = () => {}) {
  const values = { ...initialValues };
  return {
    chromeApi: {
      storage: {
        local: {
          async get(key) {
            return { [key]: values[key] };
          },
          async set(next) {
            Object.assign(values, next);
            onSet(next);
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

test("source persists the ledger before attempting cursor insertion", () => {
  const processBatch = controllerSource.match(
    /async function processBatch[\s\S]*?function handleDeliveries/,
  )?.[0] ?? "";
  const saveIndex = processBatch.indexOf("await saveLedger(ledger)");
  const insertIndex = processBatch.indexOf("await insertScannerText");
  assert.ok(saveIndex >= 0 && saveIndex < insertIndex);
});

test("persists the delivery attempt before inserting", async () => {
  const events = [];
  const { chromeApi } = createChromeStorage({}, () => events.push("ledger"));
  const controller = createCloudCursorDeliveryController({
    chromeApi,
    insertScannerText: async () => {
      events.push("insert");
      return true;
    },
    acknowledgeDelivery: async () => events.push("ack"),
    log: () => {},
    now: () => 1_000,
  });

  await controller.handleDeliveries([delivery()]);

  assert.equal(events[0], "ledger");
  assert.ok(events.indexOf("ledger") < events.indexOf("insert"));
  assert.ok(events.indexOf("insert") < events.indexOf("ack"));
});

test("never caps away unacknowledged ledger entries", async () => {
  const unacknowledged = Object.fromEntries(
    Array.from({ length: CURSOR_DELIVERY_LEDGER_LIMIT + 1 }, (_, index) => [
      `existing-${index}`,
      {
        state: "failed",
        errorCode: "no-editable-field",
        processedAt: index,
        acknowledged: false,
      },
    ]),
  );
  const { chromeApi, values } = createChromeStorage({
    [CURSOR_DELIVERY_LEDGER_KEY]: unacknowledged,
  });
  const controller = createCloudCursorDeliveryController({
    chromeApi,
    insertScannerText: async () => false,
    acknowledgeDelivery: async () => {
      throw new Error("offline");
    },
    log: () => {},
    now: () => 1_000,
  });

  await controller.handleDeliveries([delivery({ deliveryId: "new-unacknowledged" })]);

  assert.equal(
    Object.keys(values[CURSOR_DELIVERY_LEDGER_KEY]).length,
    CURSOR_DELIVERY_LEDGER_LIMIT + 2,
  );
  assert.ok(values[CURSOR_DELIVERY_LEDGER_KEY]["existing-0"]);
  assert.ok(values[CURSOR_DELIVERY_LEDGER_KEY]["new-unacknowledged"]);
});

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
