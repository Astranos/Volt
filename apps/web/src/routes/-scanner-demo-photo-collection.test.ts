import { expect, test, vi } from "vitest";
import { appendPhoto, releasePhotoUrls, type PhotoCollection } from "./-scanner-demo-photo-collection";
import type { PhotoItem } from "./-scanner-demo-model";

function photo(id: number): PhotoItem {
  return { id: String(id), objectUrl: `blob:${id}`, capturedAt: "now", filename: `${id}.jpg`, mimeType: "image/jpeg", photoBatchId: "batch", size: 1 };
}

test("replayed photo updates are pure and preserve URLs until committed cleanup", () => {
  const current: PhotoCollection = { items: Array.from({ length: 24 }, (_, index) => photo(index)), retiredUrls: [] };
  const owned = new Set(current.items.map((item) => item.objectUrl));
  owned.add("blob:24");
  const revoke = vi.fn();
  const next = appendPhoto(current, photo(24));
  expect(appendPhoto(current, photo(24))).toEqual(next);
  expect(current.items).toHaveLength(24);
  expect(current.retiredUrls).toEqual([]);
  expect(owned.has("blob:23")).toBe(true);
  expect(next.retiredUrls).toEqual(["blob:23"]);
  releasePhotoUrls(next.retiredUrls, owned, revoke);
  releasePhotoUrls(next.retiredUrls, owned, revoke);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:23");
  for (const item of next.items) expect(owned.has(item.objectUrl)).toBe(true);
});

test("batched arrivals retain all retirements and leave future queued URLs alone", () => {
  let state: PhotoCollection = { items: [], retiredUrls: [] };
  const owned = new Set<string>();
  for (let index = 0; index < 30; index++) {
    owned.add(`blob:${index}`);
    state = appendPhoto(state, photo(index));
  }
  owned.add("blob:queued-after-render");
  const revoke = vi.fn();
  releasePhotoUrls(state.retiredUrls, owned, revoke);
  expect(state.items).toHaveLength(24);
  expect(revoke).toHaveBeenCalledTimes(6);
  expect(owned.has("blob:queued-after-render")).toBe(true);
});
