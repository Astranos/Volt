import assert from "node:assert/strict";
import test from "node:test";

import {
  MOBILE_PHOTO_DOWNLOAD_CLEANUP_ALARM_NAME,
  MOBILE_PHOTO_DOWNLOAD_CLEANUP_PERIOD_MINUTES,
  DEFAULT_MOBILE_PHOTO_DOWNLOAD_RETENTION_HOURS,
  MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY,
  createMobilePhotoDownloadCleanup,
  isVoltPhotoDownloadFilename,
  nextMidnightOrNoonTimestamp,
} from "./mobile-photo-download-cleanup.ts";

const DEFAULT_RETENTION_MS =
  DEFAULT_MOBILE_PHOTO_DOWNLOAD_RETENTION_HOURS * 60 * 60 * 1000;

function createChromeStub(initialRecords = [], cmdkSettings = undefined) {
  const storage = {
    [MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY]: initialRecords,
  };
  const syncStorage = {
    cmdkSettings,
  };
  const removedFileIds = [];
  const erasedQueries = [];
  const alarms = [];

  return {
    chromeApi: {
      runtime: {},
      storage: {
        local: {
          get(defaults, callback) {
            callback({ ...defaults, ...storage });
          },
          set(values, callback) {
            Object.assign(storage, values);
            callback?.();
          },
        },
        sync: {
          get(_keys, callback) {
            callback(syncStorage);
          },
        },
      },
      downloads: {
        removeFile(downloadId, callback) {
          removedFileIds.push(downloadId);
          callback();
        },
        erase(query, callback) {
          erasedQueries.push(query);
          callback([]);
        },
      },
      alarms: {
        create(name, options) {
          alarms.push({ name, options });
        },
      },
    },
    storage,
    removedFileIds,
    erasedQueries,
    alarms,
  };
}

test("next cleanup is scheduled for local noon before noon", () => {
  const now = new Date(2026, 5, 23, 8, 15, 30).getTime();
  assert.equal(
    nextMidnightOrNoonTimestamp(now),
    new Date(2026, 5, 23, 12, 0, 0).getTime(),
  );
});

test("next cleanup is scheduled for local midnight after noon", () => {
  const now = new Date(2026, 5, 23, 18, 15, 30).getTime();
  assert.equal(
    nextMidnightOrNoonTimestamp(now),
    new Date(2026, 5, 24, 0, 0, 0).getTime(),
  );
});

test("only Volt photo download paths are accepted", () => {
  assert.equal(
    isVoltPhotoDownloadFilename("Volt Photos/session/batch/photo.jpg"),
    true,
  );
  assert.equal(isVoltPhotoDownloadFilename("Downloads/photo.jpg"), false);
  assert.equal(isVoltPhotoDownloadFilename("Volt/photo.jpg"), false);
});

test("cleanup alarm runs every 12 hours", () => {
  const { chromeApi, alarms } = createChromeStub();
  const cleanup = createMobilePhotoDownloadCleanup({
    chromeApi,
    log: () => {},
  });

  cleanup.ensureCleanupAlarm();

  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].name, MOBILE_PHOTO_DOWNLOAD_CLEANUP_ALARM_NAME);
  assert.equal(
    alarms[0].options.periodInMinutes,
    MOBILE_PHOTO_DOWNLOAD_CLEANUP_PERIOD_MINUTES,
  );
});

test("recording a Volt photo download stores a 24 hour delete time", async () => {
  const { chromeApi, storage } = createChromeStub();
  const cleanup = createMobilePhotoDownloadCleanup({
    chromeApi,
    log: () => {},
  });
  const downloadedAt = Date.parse("2026-06-23T10:00:00.000Z");

  await cleanup.recordMobilePhotoDownload({
    downloadId: 42,
    filename: "Volt Photos/session/batch/photo.jpg",
    downloadedAt,
  });

  assert.deepEqual(storage[MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY], [
    {
      downloadId: 42,
      filename: "Volt Photos/session/batch/photo.jpg",
      downloadedAt,
      deleteAfter: downloadedAt + DEFAULT_RETENTION_MS,
    },
  ]);
});

test("recording uses the configured retention window", async () => {
  const { chromeApi, storage } = createChromeStub([], {
    mobilePhotoDownloads: {
      autoDeleteEnabled: true,
      retentionHours: 12,
    },
  });
  const cleanup = createMobilePhotoDownloadCleanup({
    chromeApi,
    log: () => {},
  });
  const downloadedAt = Date.parse("2026-06-23T10:00:00.000Z");

  await cleanup.recordMobilePhotoDownload({
    downloadId: 43,
    filename: "Volt Photos/session/batch/photo.jpg",
    downloadedAt,
  });

  assert.equal(
    storage[MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY][0].deleteAfter,
    downloadedAt + 12 * 60 * 60 * 1000,
  );
});

test("recording is skipped when auto-delete is disabled", async () => {
  const { chromeApi, storage } = createChromeStub([], {
    mobilePhotoDownloads: {
      autoDeleteEnabled: false,
      retentionHours: 24,
    },
  });
  const cleanup = createMobilePhotoDownloadCleanup({
    chromeApi,
    log: () => {},
  });

  const recorded = await cleanup.recordMobilePhotoDownload({
    downloadId: 44,
    filename: "Volt Photos/session/batch/photo.jpg",
    downloadedAt: Date.parse("2026-06-23T10:00:00.000Z"),
  });

  assert.equal(recorded, false);
  assert.deepEqual(storage[MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY], []);
});

test("cleanup removes expired downloads and retains fresh downloads", async () => {
  const now = Date.parse("2026-06-24T12:00:00.000Z");
  const expiredAt = now - DEFAULT_RETENTION_MS - 1;
  const freshAt = now - DEFAULT_RETENTION_MS + 1;
  const { chromeApi, storage, removedFileIds, erasedQueries } = createChromeStub([
    {
      downloadId: 1,
      filename: "Volt Photos/session/batch/old.jpg",
      downloadedAt: expiredAt,
      deleteAfter: expiredAt + DEFAULT_RETENTION_MS,
    },
    {
      downloadId: 2,
      filename: "Volt Photos/session/batch/fresh.jpg",
      downloadedAt: freshAt,
      deleteAfter: freshAt + DEFAULT_RETENTION_MS,
    },
  ]);
  const cleanup = createMobilePhotoDownloadCleanup({
    chromeApi,
    log: () => {},
  });

  const result = await cleanup.cleanupExpiredDownloads(now);

  assert.deepEqual(removedFileIds, [1]);
  assert.deepEqual(erasedQueries, [{ id: 1 }]);
  assert.equal(result.deleted, 1);
  assert.deepEqual(storage[MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY], [
    {
      downloadId: 2,
      filename: "Volt Photos/session/batch/fresh.jpg",
      downloadedAt: freshAt,
      deleteAfter: freshAt + DEFAULT_RETENTION_MS,
    },
  ]);
});

test("cleanup is skipped when auto-delete is disabled", async () => {
  const now = Date.parse("2026-06-24T12:00:00.000Z");
  const expiredAt = now - DEFAULT_RETENTION_MS - 1;
  const { chromeApi, storage, removedFileIds, erasedQueries } = createChromeStub(
    [
      {
        downloadId: 1,
        filename: "Volt Photos/session/batch/old.jpg",
        downloadedAt: expiredAt,
        deleteAfter: expiredAt + DEFAULT_RETENTION_MS,
      },
    ],
    {
      mobilePhotoDownloads: {
        autoDeleteEnabled: false,
        retentionHours: 24,
      },
    },
  );
  const cleanup = createMobilePhotoDownloadCleanup({
    chromeApi,
    log: () => {},
  });

  const result = await cleanup.cleanupExpiredDownloads(now);

  assert.deepEqual(removedFileIds, []);
  assert.deepEqual(erasedQueries, []);
  assert.deepEqual(result, { checked: 0, retained: 0, deleted: 0 });
  assert.equal(storage[MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY].length, 1);
});
