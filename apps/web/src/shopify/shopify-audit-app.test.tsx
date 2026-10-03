import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ErrorNotice, formatErrorMessage } from "./shopify-audit-app";

describe("Shopify audit error recovery", () => {
  test("network fetch errors become a useful message instead of raw browser text", () => {
    const message = formatErrorMessage(new TypeError("Failed to fetch"));

    expect(message).toContain("Check your connection and try again");
    expect(message).not.toContain("Failed to fetch");
    expect(formatErrorMessage(new Error("Shop authorization expired."))).toBe("Shop authorization expired.");
  });

  test("error notice includes a retry action", () => {
    const html = renderToStaticMarkup(
      <ErrorNotice message="Couldn’t reach Volt’s Shopify service." onRetry={() => {}} />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn’t reach Volt’s Shopify service.");
    expect(html).toContain('type="button"');
    expect(html).toContain("Try again");
  });
});
