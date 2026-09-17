export type Point = { x: number; y: number };
export function isPhotoDrag(start: Point, end: Point): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) > 10;
}
export function swipeDirection(start: Point, end: Point): -1 | 0 | 1 {
  const x = end.x - start.x;
  const y = end.y - start.y;
  if (Math.abs(x) < 40 || Math.abs(x) < Math.abs(y) * 1.4) return 0;
  return x < 0 ? 1 : -1;
}
export function nextPhoto(
  current: number,
  direction: number,
  count: number,
): number {
  return count > 0 ? (current + direction + count) % count : 0;
}
