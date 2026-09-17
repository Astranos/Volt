import { describe, expect, it } from "vitest";
import { nextPhoto, swipeDirection } from "./gallery";
describe("gallery gestures", () => {
  const start = { x: 100, y: 100 };
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
