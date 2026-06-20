import { parseMessageRecord, type MessageRecord, type RuntimeMessage } from "./messages";
import type { LogFn } from "./runtime-action-registry";

type PriceChartingControllerOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
};

const MAX_PENDING_PC_ITEMS = 250;

function clampString(value: unknown, maxLength = 300) {
  const str = typeof value === "string" ? value : "";
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizePriceChartingDetails(details: unknown) {
  if (!details || typeof details !== "object") return null;
  const entries = Object.entries(details).slice(0, 20);
  const sanitized: Record<string, string> = {};
  entries.forEach(([rawKey, rawValue]) => {
    const key = clampString(rawKey, 64).trim();
    if (!key) return;
    sanitized[key] = clampString(rawValue, 320);
  });
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizePriceChartingItem(item: unknown) {
  const candidate = parseMessageRecord(item);
  if (!candidate) return null;
  const price = Math.max(0, toFiniteNumber(candidate.price, 0));
  const quantity = Math.max(1, Math.floor(toFiniteNumber(candidate.quantity, 1)));
  return {
    id:
      clampString(candidate.id, 64) ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: clampString(candidate.title, 220),
    console: clampString(candidate.console, 120),
    price,
    condition: clampString(candidate.condition, 64),
    url: clampString(candidate.url, 500),
    saleTitle: clampString(candidate.saleTitle, 220),
    upc: clampString(candidate.upc, 64),
    imageUrl: clampString(candidate.imageUrl, 500),
    details: sanitizePriceChartingDetails(candidate.details),
    quantity,
  };
}

export function createPriceChartingController({
  chromeApi,
  log,
}: PriceChartingControllerOptions) {
  function handleMessage(message: RuntimeMessage, sendResponse: (response?: unknown) => void) {
    if (!("type" in message) || message.type !== "PC_ITEM_SELECTED" || !message.data) {
      return false;
    }

    const sanitizedItem = sanitizePriceChartingItem(message.data);
    if (!sanitizedItem) {
      sendResponse({ success: false, error: "invalid_item" });
      return true;
    }
    log("PC_ITEM_SELECTED received", sanitizedItem);

    chromeApi.storage.local.get(
      { volt_pricecharting_pending_items: [] },
      (result: MessageRecord) => {
        const pendingItems = Array.isArray(result.volt_pricecharting_pending_items)
          ? result.volt_pricecharting_pending_items
          : [];
        pendingItems.push(sanitizedItem);
        if (pendingItems.length > MAX_PENDING_PC_ITEMS) {
          pendingItems.splice(0, pendingItems.length - MAX_PENDING_PC_ITEMS);
        }
        chromeApi.storage.local.set(
          { volt_pricecharting_pending_items: pendingItems },
          () => {
            log("Item saved to pending queue");
          }
        );
      }
    );

    sendResponse({ success: true });
    return true;
  }

  return { handleMessage };
}
