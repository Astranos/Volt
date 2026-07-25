import { storageLocal } from "../access/storage-local";

// Clerk's own shape (its StorageCache type is not exported from the package
// root, and matching it structurally avoids reaching into dist/).
export type OffscreenStorageCache = {
  createKey: (...keys: string[]) => string;
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  remove: (key: string) => Promise<void>;
  set: (key: string, value: string) => Promise<void>;
};

/**
 * Clerk's token cache, backed by the shared extension store.
 *
 * Clerk's default cache reads `browser.storage.local`, which is a straight
 * mirror of `chrome` — and chrome.storage does not exist in an offscreen
 * document, so every token fetch there died on "Cannot read properties of
 * undefined (reading 'local')" and the document settled on signed out. That is
 * what left cursor deliveries undelivered.
 *
 * createKey matches Clerk's own joiner, and the keys stay unprefixed, because
 * the service worker mirrors the account cookie under the key Clerk itself
 * computes and this cache has to read that exact key for the two to meet.
 */
export const offscreenStorageCache: OffscreenStorageCache = {
  createKey: (...keys: string[]) => keys.filter(Boolean).join("|"),
  get: async <T = unknown>(key: string) => {
    const stored = await storageLocal.get([key]);
    return (stored[key] ?? undefined) as T | undefined;
  },
  remove: async (key: string) => {
    await storageLocal.remove([key]);
  },
  set: async (key: string, value: string) => {
    await storageLocal.set({ [key]: value });
  },
};
