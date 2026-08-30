import { describe, expect, test } from "vitest";

import { redactSecret, sanitizeConvexValue } from "./paymore-inventory";

describe("PayMore inventory crawl boundary", () => {
  test("normalizes unsafe API object keys before sending a page to Convex", () => {
    expect(
      sanitizeConvexValue({
        other_attributes: {
          "MFG Warranty?\t": "Apple Limited Warranty",
          "Café\nLabel": "value",
          "$private": "ignored",
        },
        items: [{ "Serial#\r": "ABC123" }],
      }),
    ).toEqual({
      other_attributes: {
        "MFG Warranty?": "Apple Limited Warranty",
        "Caf Label": "value",
      },
      items: [{ "Serial#": "ABC123" }],
    });
  });

  test("redacts the crawl secret from subprocess failures", () => {
    expect(redactSecret("command failed with secret-value", "secret-value"))
      .toBe("command failed with [REDACTED]");
  });
});
