import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { convexErrorText } from "./convex-error";

test("uses a ConvexError's data instead of the redacted production message", () => {
  const error = new ConvexError("Shopify authorization expired or failed. Reconnect your store.");
  error.message = "[CONVEX A(shopifyAudit:searchProducts)] [Request ID: abc] Server Error Called by client";
  expect(convexErrorText(error)).toBe("Shopify authorization expired or failed. Reconnect your store.");
  expect(convexErrorText(new ConvexError({ message: "Store disconnected." }))).toBe("Store disconnected.");
});

test("falls back to the message for other errors", () => {
  expect(convexErrorText(new Error("Network down"))).toBe("Network down");
  expect(convexErrorText(new ConvexError({ code: 3 }))).toMatch(/.+/);
  expect(convexErrorText("plain")).toBe("plain");
});
