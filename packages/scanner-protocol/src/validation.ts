export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isIsoDateString(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

export function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
