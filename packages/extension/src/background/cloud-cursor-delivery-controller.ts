const CURSOR_DELIVERY_LEDGER_KEY = "volt.cloudScanner.cursorDeliveryLedger.v1";
const CURSOR_DELIVERY_LEDGER_LIMIT = 500;
const CURSOR_DELIVERY_LEDGER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingCursorDelivery = {
  deliveryId: string;
  resultId: string;
  kind: "barcode" | "text";
  text: string;
  format?: string;
  expiresAt: number;
};

type CursorDeliveryOutcome = {
  state: "delivered" | "failed";
  errorCode?: "expired" | "no-editable-field";
  processedAt: number;
  acknowledged: boolean;
};

type CursorDeliveryLedger = Record<string, CursorDeliveryOutcome>;

type CloudCursorDeliveryControllerOptions = {
  chromeApi: typeof chrome;
  insertScannerText: (
    text: string,
    options?: { format?: string; kind?: string },
  ) => Promise<boolean>;
  acknowledgeDelivery: (
    deliveryId: string,
    outcome: Pick<CursorDeliveryOutcome, "state" | "errorCode">,
  ) => Promise<void>;
  log: (...args: unknown[]) => void;
  now?: () => number;
};

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeOutcome(value: unknown): CursorDeliveryOutcome | null {
  const record = recordFrom(value);
  if (!record || (record.state !== "delivered" && record.state !== "failed")) return null;
  if (typeof record.processedAt !== "number" || !Number.isFinite(record.processedAt)) return null;
  return {
    state: record.state,
    ...(record.errorCode === "expired" || record.errorCode === "no-editable-field"
      ? { errorCode: record.errorCode }
      : {}),
    processedAt: record.processedAt,
    acknowledged: record.acknowledged === true,
  };
}

export function normalizePendingCursorDeliveries(value: unknown): PendingCursorDelivery[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordFrom(item);
    if (
      !record
      || typeof record.deliveryId !== "string"
      || !record.deliveryId
      || typeof record.resultId !== "string"
      || !record.resultId
      || (record.kind !== "barcode" && record.kind !== "text")
      || typeof record.text !== "string"
      || typeof record.expiresAt !== "number"
      || !Number.isFinite(record.expiresAt)
    ) return [];
    return [{
      deliveryId: record.deliveryId,
      resultId: record.resultId,
      kind: record.kind,
      text: record.text,
      ...(typeof record.format === "string" ? { format: record.format } : {}),
      expiresAt: record.expiresAt,
    }];
  });
}

export function createCloudCursorDeliveryController({
  chromeApi,
  insertScannerText,
  acknowledgeDelivery,
  log,
  now = Date.now,
}: CloudCursorDeliveryControllerOptions) {
  let processing = Promise.resolve();

  async function loadLedger(): Promise<CursorDeliveryLedger> {
    const stored = await chromeApi.storage.local.get(CURSOR_DELIVERY_LEDGER_KEY);
    const record = recordFrom(stored[CURSOR_DELIVERY_LEDGER_KEY]) ?? {};
    return Object.fromEntries(
      Object.entries(record).flatMap(([deliveryId, value]) => {
        const outcome = normalizeOutcome(value);
        return outcome ? [[deliveryId, outcome]] : [];
      }),
    );
  }

  async function saveLedger(ledger: CursorDeliveryLedger) {
    const cutoff = now() - CURSOR_DELIVERY_LEDGER_RETENTION_MS;
    const entries = Object.entries(ledger)
      .filter(([, outcome]) => !outcome.acknowledged || outcome.processedAt >= cutoff)
      .sort((lhs, rhs) => rhs[1].processedAt - lhs[1].processedAt);
    const unacknowledged = entries
      .filter(([, outcome]) => !outcome.acknowledged)
      .slice(0, CURSOR_DELIVERY_LEDGER_LIMIT);
    const acknowledged = entries
      .filter(([, outcome]) => outcome.acknowledged)
      .slice(0, Math.max(0, CURSOR_DELIVERY_LEDGER_LIMIT - unacknowledged.length));
    await chromeApi.storage.local.set({
      [CURSOR_DELIVERY_LEDGER_KEY]: Object.fromEntries([...unacknowledged, ...acknowledged]),
    });
  }

  async function acknowledge(
    ledger: CursorDeliveryLedger,
    deliveryId: string,
    outcome: CursorDeliveryOutcome,
  ) {
    try {
      await acknowledgeDelivery(deliveryId, outcome);
      ledger[deliveryId] = { ...outcome, acknowledged: true };
      await saveLedger(ledger);
    } catch (error) {
      log(
        "cloud cursor delivery acknowledgement failed",
        deliveryId,
        error instanceof Error ? error.message : error,
      );
    }
  }

  async function processBatch(deliveries: PendingCursorDelivery[]) {
    const ledger = await loadLedger();
    for (const delivery of deliveries) {
      const previous = ledger[delivery.deliveryId];
      if (previous) {
        if (!previous.acknowledged) {
          await acknowledge(ledger, delivery.deliveryId, previous);
        }
        continue;
      }

      const outcome: CursorDeliveryOutcome = delivery.expiresAt <= now()
        ? {
            state: "failed",
            errorCode: "expired",
            processedAt: now(),
            acknowledged: false,
          }
        : await insertScannerText(delivery.text, {
            kind: delivery.kind,
            ...(delivery.format ? { format: delivery.format } : {}),
          })
          ? { state: "delivered", processedAt: now(), acknowledged: false }
          : {
              state: "failed",
              errorCode: "no-editable-field",
              processedAt: now(),
              acknowledged: false,
            };

      ledger[delivery.deliveryId] = outcome;
      await saveLedger(ledger);
      await acknowledge(ledger, delivery.deliveryId, outcome);
    }
  }

  function handleDeliveries(value: unknown) {
    const deliveries = normalizePendingCursorDeliveries(value);
    processing = processing
      .then(() => processBatch(deliveries))
      .catch((error: unknown) => {
        log(
          "cloud cursor delivery processing failed",
          error instanceof Error ? error.message : error,
        );
      });
    return processing;
  }

  return { handleDeliveries };
}

export {
  CURSOR_DELIVERY_LEDGER_KEY,
  CURSOR_DELIVERY_LEDGER_LIMIT,
  CURSOR_DELIVERY_LEDGER_RETENTION_MS,
};
