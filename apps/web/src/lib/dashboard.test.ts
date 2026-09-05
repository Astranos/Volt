import { describe, expect, test } from "vitest";
import {
  batchResults,
  type CaptureBatch,
  type CaptureResult,
} from "./workspace";
import {
  captureActivity,
  captureCounts,
  capturesCsv,
  visibleSections,
} from "./dashboard";

function result(
  id: string,
  overrides: Partial<CaptureResult> = {},
): CaptureResult {
  return {
    id,
    type: "text",
    deliveryState: "available",
    value: "Camera ABC-123",
    createdAt: "2026-09-04T12:00:00",
    byteCount: 10,
    ...overrides,
  };
}

function batch(
  id: string,
  results: CaptureResult[],
  createdAt = "2026-09-04T12:00:00",
): CaptureBatch {
  return {
    id,
    results,
    createdAt,
    updatedAt: createdAt,
    deliveryState: "available",
    deliveries: [],
  };
}

describe("dashboard data", () => {
  test("counts only live captures and isolates trash", () => {
    expect(
      captureCounts([
        batch("b", [
          result("1"),
          result("2", { type: "photo" }),
          result("3", { deliveryState: "deleted" }),
        ]),
      ]),
    ).toEqual({
      all: 2,
      text: 1,
      photo: 1,
      barcode: 0,
      dictation: 0,
      trash: 1,
    });
  });

  test("search keeps related photos, but does not surface deleted text in live search", () => {
    const batches = [
      batch("b", [
        result("1"),
        result("2", { type: "photo", value: undefined }),
        result("3", { value: "secret", deliveryState: "deleted" }),
      ]),
    ];
    expect(
      visibleSections(batches, "photo", "abc-123")[0]?.batches[0]?.results.map(
        (item) => item.id,
      ),
    ).toEqual(["2"]);
    expect(visibleSections(batches, "all", "secret")).toEqual([]);
    expect(
      visibleSections(batches, "trash", "secret")[0]?.batches[0]?.results.map(
        (item) => item.id,
      ),
    ).toEqual(["3"]);
    expect(visibleSections(batches, "all", "missing")).toEqual([]);
  });

  test("orders batches newest first without changing server data", () => {
    const batches = [
      batch("old", [result("1")], "2026-09-03T12:00:00"),
      batch("new", [result("2")]),
    ];
    expect(
      visibleSections(batches, "all", "").map(
        (section) => section.batches[0]?.batch.id,
      ),
    ).toEqual(["new", "old"]);
    expect(batches[0]?.id).toBe("old");
  });

  test("activity uses local calendar days and excludes trash and older captures", () => {
    const activity = captureActivity(
      [
        batch("b", [
          result("1"),
          result("2", { createdAt: "2026-09-03T23:59:00" }),
          result("3", { deliveryState: "deleted" }),
          result("4", { createdAt: "2026-08-20T12:00:00" }),
        ]),
      ],
      new Date("2026-09-04T15:00:00"),
    );
    expect(activity.map((day) => day.count)).toEqual([0, 0, 0, 0, 0, 1, 1]);
  });

  test("CSV quotes text and neutralizes spreadsheet formula injection", () => {
    const csv = capturesCsv(
      batchResults(
        batch("b", [
          result("1", { value: '=HYPERLINK("https://example.com")' }),
          result("2", { value: "  +123" }),
          result("3", { value: "hello,\nworld" }),
        ]),
      ),
    );
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"\'  +123"');
    expect(csv).toContain('"hello,\nworld"');
    expect(capturesCsv([]).split("\r\n")).toHaveLength(1);
  });
});
