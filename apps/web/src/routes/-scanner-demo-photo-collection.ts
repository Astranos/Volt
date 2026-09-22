import { MAX_PHOTO_ITEMS, type PhotoItem } from "./-scanner-demo-model";

export type PhotoCollection = {
  items: PhotoItem[];
  retiredUrls: string[];
};

export function appendPhoto(current: PhotoCollection, photo: PhotoItem): PhotoCollection {
  const next = [photo, ...current.items];
  return {
    items: next.slice(0, MAX_PHOTO_ITEMS),
    retiredUrls: [...current.retiredUrls, ...next.slice(MAX_PHOTO_ITEMS).map((item) => item.objectUrl)],
  };
}

export function releasePhotoUrls(urls: readonly string[], owned: Set<string>, revoke: (url: string) => void) {
  for (const url of urls) {
    if (!owned.delete(url)) continue;
    revoke(url);
  }
}
