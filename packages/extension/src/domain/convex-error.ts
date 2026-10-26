import { ConvexError } from "convex/values";

/**
 * Production Convex redacts error messages to "Server Error"; a ConvexError's own
 * text (e.g. "Reconnect your store." or a HANDBOOK_* code) arrives in `data`.
 */
export function convexErrorText(error: unknown): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "string" && data) return data;
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string" && data.message) return data.message;
  }
  return error instanceof Error ? error.message : String(error);
}
