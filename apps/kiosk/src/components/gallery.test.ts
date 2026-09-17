import { describe, expect, it } from "vitest";
import { isPhotoDrag, nextPhoto, swipeDirection } from "./gallery";
describe("gallery gestures", () => {
  const start = { x: 100, y: 100 };
  it("allows taps but suppresses clicks after horizontal or vertical drags", () => {
    expect(isPhotoDrag(start, start)).toBe(false);
    expect(isPhotoDrag(start, { x: 105, y: 105 })).toBe(false);
    expect(isPhotoDrag(start, { x: 120, y: 100 })).toBe(true);
    expect(isPhotoDrag(start, { x: 40, y: 100 })).toBe(true);
    expect(isPhotoDrag(start, { x: 100, y: 140 })).toBe(true);
  });
  it("advances left and returns right", () => {
    expect(swipeDirection(start, { x: 40, y: 110 })).toBe(1);
    expect(swipeDirection(start, { x: 160, y: 95 })).toBe(-1);
  });
  it("ignores taps, short drags and vertical scrolling", () => {
    expect(swipeDirection(start, start)).toBe(0);
    expect(swipeDirection(start, { x: 70, y: 100 })).toBe(0);
    expect(swipeDirection(start, { x: 40, y: 180 })).toBe(0);
    expect(swipeDirection(start, { x: 50, y: 150 })).toBe(0);
  });
  it("wraps and handles empty galleries", () => {
    expect(nextPhoto(2, 1, 3)).toBe(0);
    expect(nextPhoto(0, -1, 3)).toBe(2);
    expect(nextPhoto(0, 1, 0)).toBe(0);
    expect(nextPhoto(0, 1, 1)).toBe(0);
  });
});
