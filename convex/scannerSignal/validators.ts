import { v } from "convex/values";

export const pushSubscriptionValidator = v.object({
  endpoint: v.string(),
  expirationTime: v.optional(v.union(v.number(), v.null())),
  keys: v.object({
    auth: v.string(),
    p256dh: v.string(),
  }),
});

export const optionalString = v.optional(v.string());
export const optionalStringArray = v.optional(v.array(v.string()));

export function clampNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
