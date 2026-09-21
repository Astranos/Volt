import type { AuditAssessment, AuditItem, SoldComparable } from "./types";

const MINIMUM_MATCH_PROBABILITY = 0.7;

function isPositiveCents(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Prices are item-only USD cents; callers must verify sold status and identity first. */
export function assessPrice(
  item: AuditItem,
  comparables: SoldComparable[],
  tolerancePercent: number,
): AuditAssessment {
  if (item.currency !== "USD" || !isPositiveCents(item.priceCents)) {
    return { kind: "insufficient", reason: "The store price must be a positive, exact USD amount." };
  }
  if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100) {
    return { kind: "insufficient", reason: "Price tolerance must be between 0 and 100 percent." };
  }

  const unique = new Map<string, number>();
  for (const comparable of comparables) {
    if (
      !comparable.id.trim() ||
      !isPositiveCents(comparable.priceCents) ||
      !Number.isFinite(comparable.matchProbability) ||
      comparable.matchProbability < MINIMUM_MATCH_PROBABILITY ||
      comparable.matchProbability > 1 ||
      !Number.isFinite(comparable.decisionConfidence) ||
      comparable.decisionConfidence < 0 ||
      comparable.decisionConfidence > 1
    ) {
      return { kind: "insufficient", reason: "The sold evidence contains an invalid price or an uncertain match." };
    }
    const existing = unique.get(comparable.id);
    if (existing !== undefined && existing !== comparable.priceCents) {
      return { kind: "insufficient", reason: "A sold listing has conflicting observed prices." };
    }
    unique.set(comparable.id, comparable.priceCents);
  }
  if (unique.size < 3) {
    return { kind: "insufficient", reason: "At least three unique, confident sold matches are required." };
  }

  const prices = [...unique.values()].sort((left, right) => left - right);
  const middle = Math.floor(prices.length / 2);
  const upper = prices[middle];
  const lower = prices[prices.length % 2 === 0 ? middle - 1 : middle];
  if (lower === undefined || upper === undefined) {
    return { kind: "insufficient", reason: "No median could be established from the sold evidence." };
  }
  // Round a half-cent median up without summing two potentially large integers.
  const medianCents = lower + Math.ceil((upper - lower) / 2);
  const margin = medianCents * (tolerancePercent / 100);
  const lowCents = Math.ceil(medianCents - margin);
  const highCents = Math.floor(medianCents + margin);
  if (!Number.isSafeInteger(lowCents) || !Number.isSafeInteger(highCents)) {
    return { kind: "insufficient", reason: "The comparison price range exceeds supported amounts." };
  }
  return {
    kind: item.priceCents < lowCents ? "low" : item.priceCents > highCents ? "high" : "fair",
    medianCents,
    lowCents,
    highCents,
    differencePercent: ((item.priceCents - medianCents) / medianCents) * 100,
  };
}
