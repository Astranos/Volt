import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  CatalogActivityContent,
  CatalogActivityError,
  CatalogActivityBoundary,
  isTrackedDay,
  utcDayStart,
} from "./catalog-activity";

const september4 = Date.UTC(2026, 8, 4);
const september5 = Date.UTC(2026, 8, 5);
type Activity = NonNullable<React.ComponentProps<typeof CatalogActivityContent>["data"]>;
const data: Activity = {
  days: 7,
  trackingStartedAt: september5 + 3_600_000,
  lastIngestAt: september5 + 7_200_000,
  points: [
    { dayStart: september4, inserted: 0, refreshed: 0, sourcesAdded: 0, batches: 0 },
    { dayStart: september5, inserted: 12, refreshed: 25, sourcesAdded: 8, batches: 2 },
  ],
  totals: { inserted: 12, refreshed: 25, sourcesAdded: 8, batches: 2 },
};

describe("catalog activity", () => {
  test("maps UTC days and distinguishes unavailable history from tracked zeroes", () => {
    expect(utcDayStart(september5 + 86_399_999)).toBe(september5);
    expect(utcDayStart(september5 + 86_400_000)).toBe(september5 + 86_400_000);
    expect(isTrackedDay(september4, data.trackingStartedAt)).toBe(false);
    expect(isTrackedDay(september5, data.trackingStartedAt)).toBe(true);
    expect(isTrackedDay(september5, null)).toBe(false);
  });

  test("renders loading separately from empty history", () => {
    const html = renderToStaticMarkup(<CatalogActivityContent data={undefined} days={7} onDaysChange={() => {}} />);
    expect(html).toContain("Loading catalog activity");
    expect(html).not.toContain("tracking starts");
    expect(html).not.toContain("New products");
  });

  test("does not draw zero history before tracking starts", () => {
    const html = renderToStaticMarkup(<CatalogActivityContent data={{ ...data, trackingStartedAt: null, lastIngestAt: null }} days={7} onDaysChange={() => {}} />);
    expect(html).toContain("Activity tracking starts with the next import");
    expect(html).toContain("Earlier import history is unavailable");
    expect(html).not.toContain("View daily counts");
    expect(html).not.toContain("12");
  });

  test("uses actual server totals and exposes exact daily data and tracking caveat", () => {
    const html = renderToStaticMarkup(<CatalogActivityContent data={data} days={7} onDaysChange={() => {}} />);
    expect(html).toContain("Sep 4 UTC: history unavailable");
    expect(html).toContain("Sep 5 UTC: 12 new products, 25 refreshes, 8 source links added, 2 import batches");
    expect(html).toContain("Counts begin Sep 5, 1:00 AM UTC");
    expect(html).toContain("Earlier dates are unavailable, not zero");
    expect(html).toContain("Repeat imports count as refreshes");
    expect(html).toContain("View daily counts");
    expect(html).toContain('colSpan="4"');
    expect(html).toContain("Unavailable");
    expect(html).toContain("Source links added");
  });

  test("isolates sanitized activity errors with retry", () => {
    expect(CatalogActivityBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const html = renderToStaticMarkup(<CatalogActivityError retry={() => {}} />);
    expect(html).toContain("Activity is temporarily unavailable");
    expect(html).toContain("You can still search and compare products in the catalog");
    expect(html).toContain("Retry activity");
    expect(html).not.toContain("ConvexError");
  });
});
