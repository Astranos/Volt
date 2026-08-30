const LABEL_ALIASES: Record<string, string> = {
  collection: "collection",
  brand: "brand",
  model: "model",
  mpn: "mpn",
  color: "color",
  "storage size": "storage",
  storage: "storage",
  "carrier service": "carrier",
  carrier: "carrier",
  publisher: "publisher",
  genre: "genre",
  rating: "rating",
  "esrb rating": "rating",
  "release year": "releaseYear",
  "screen size": "screenSize",
  "sim card slot": "simSlot",
  condition: "condition",
  imei: "imei",
  "serial#": "serial",
  serial: "serial",
  "battery health": "batteryHealth",
  "cycle count": "cycleCount",
  "lock status": "lockStatus",
  "ios version": "osVersion",
  "os version": "osVersion",
  "mfg warranty": "warranty",
  warranty: "warranty",
  sku: "sku",
  graded: "graded",
  "case/box": "hasCase",
  manual: "hasManual",
  inserts: "hasInserts",
  "downloadable content": "hasDlc",
};

const SKIP_LABELS = new Set([
  "upc",
  "upc/barcode",
  "barcode",
  "gtin",
  "gtin-12",
  "gtin12",
  "game name",
  "title",
  "product title",
  "platform",
  // PayMore API rows carry a literal filler label instead of an attribute.
  "this will go at the end of the title",
]);

const LISTING_KEYS = new Set([
  "condition",
  "sku",
  "graded",
  "hasCase",
  "hasManual",
  "hasInserts",
  "hasDlc",
]);

// Unit-only fields describe one physical device instance. They cannot be
// verified from a UPC/model/MPN and they change per unit, so the crawler never
// persists them: serial numbers, IMEIs/ESN/MEID, battery health, cycle count,
// lock/activation state, firmware version, and warranty status.
const UNIT_ONLY_KEYS = new Set([
  "imei",
  "serial",
  "esn",
  "meid",
  "passcode",
  "batteryHealth",
  "cycleCount",
  "lockStatus",
  "osVersion",
  "warranty",
]);

const UNIT_ONLY_LABEL =
  /serial|imei|\besn\b|\bmeid\b|passcode|battery|cycle|lock|warrant|firmware|icloud|find my|os version|ios version/i;

export const PRODUCT_ATTRIBUTE_KEYS = [
  "collection",
  "brand",
  "model",
  "mpn",
  "color",
  "storage",
  "carrier",
  "publisher",
  "genre",
  "rating",
  "releaseYear",
] as const;

export type ProductAttributeKey = (typeof PRODUCT_ATTRIBUTE_KEYS)[number];

export type SplitAttributes = {
  product: Record<string, string>;
  listing: Record<string, string>;
};

export function canonicalSpecLabel(label: string): string | null {
  // Spec tables end labels with :, ?, or * and quotes values inconsistently.
  const normalized = label.replace(/[:?*]+$/, "").trim().toLowerCase();
  if (!normalized || SKIP_LABELS.has(normalized)) return null;
  return LABEL_ALIASES[normalized] ?? normalized.replace(/[^a-z0-9]+([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

export function splitSpecAttributes(specs: Iterable<[string, string]>): SplitAttributes {
  const product: Record<string, string> = {};
  const listing: Record<string, string> = {};
  for (const [label, rawValue] of specs) {
    const normalizedLabel = label.replace(/[:?*]+$/, "").trim().toLowerCase();
    if (UNIT_ONLY_LABEL.test(normalizedLabel)) continue;
    const key = canonicalSpecLabel(label);
    const value = rawValue.trim();
    if (!key || !value) continue;
    if (UNIT_ONLY_KEYS.has(key)) continue;
    if (LISTING_KEYS.has(key)) listing[key] = value;
    else product[key] = value;
  }
  return { product, listing };
}

export function pickProductAttribute(
  attributes: Record<string, string>,
  key: ProductAttributeKey,
): string | null {
  const value = attributes[key]?.trim();
  return value ? value : null;
}

export function omitProductAttributeKeys(attributes: Record<string, string>): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if ((PRODUCT_ATTRIBUTE_KEYS as readonly string[]).includes(key)) continue;
    extra[key] = value;
  }
  return extra;
}

export function mergeAttributeRecords(
  current: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (!value) continue;
    const existing = merged[key];
    if (!existing || value.length > existing.length) merged[key] = value;
  }
  return merged;
}
