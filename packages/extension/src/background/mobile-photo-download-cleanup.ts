import type { CmdkSettings, SyncStorageResult } from "../types/settings.ts";
import type { MobilePhotoDownloadCleanupReceipt } from "../domain/mobile-photo-delivery-ledger.ts";

type LogFn = (...args: unknown[]) => void;

export const MOBILE_PHOTO_DOWNLOAD_CLEANUP_ALARM_NAME =
  "volt.mobilePhotoDownloads.cleanup";
export const MOBILE_PHOTO_DOWNLOAD_CLEANUP_PERIOD_MINUTES = 24 * 60;
export const DEFAULT_MOBILE_PHOTO_DOWNLOAD_RETENTION_HOURS = 24;
export const MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY =
  "volt.mobilePhotoDownloads.v1";

export type MobilePhotoDownloadRecord = {
  downloadId: number;
  filename: string;
  downloadedAt: number;
  deleteAfter: number;
};

type MobilePhotoDownloadCleanupOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
};

function isRecord(value: unknown): value is MobilePhotoDownloadRecord {
  const record = value as Partial<MobilePhotoDownloadRecord> | null;
  return (
    Boolean(record) &&
    typeof record?.downloadId === "number" &&
    typeof record?.filename === "string" &&
    typeof record?.downloadedAt === "number" &&
    typeof record?.deleteAfter === "number"
  );
}

export function isVoltPhotoDownloadFilename(filename: string) {
  return filename === "Volt Photos" || filename.startsWith("Volt Photos/");
}

export function nextMidnightTimestamp(now = Date.now()) {
  const current = new Date(now);
  const next = new Date(current);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);

  return next.getTime();
}

function getStoredDownloads(chromeApi: typeof chrome) {
  return new Promise<MobilePhotoDownloadRecord[]>((resolve) => {
    chromeApi.storage.local.get(
      { [MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY]: [] },
      (stored) => {
        const records = Array.isArray(stored[MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY])
          ? stored[MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY].filter(isRecord)
          : [];
        resolve(records);
      },
    );
  });
}

function getExtensionSettings(chromeApi: typeof chrome) {
  return new Promise<CmdkSettings["mobilePhotoDownloads"]>((resolve) => {
    chromeApi.storage.sync.get(["cmdkSettings"], (result: SyncStorageResult) => {
      resolve(result.cmdkSettings?.mobilePhotoDownloads);
    });
  });
}

function normalizeCleanupSettings(
  settings: CmdkSettings["mobilePhotoDownloads"],
) {
  const retentionHours =
    typeof settings?.retentionHours === "number" &&
    Number.isFinite(settings.retentionHours) &&
    settings.retentionHours > 0
      ? settings.retentionHours
      : DEFAULT_MOBILE_PHOTO_DOWNLOAD_RETENTION_HOURS;

  return {
    autoDeleteEnabled: settings?.autoDeleteEnabled !== false,
    retentionHours,
  };
}

function retentionHoursToMs(hours: number) {
  const safeHours =
    Number.isFinite(hours) && hours > 0
      ? hours
      : DEFAULT_MOBILE_PHOTO_DOWNLOAD_RETENTION_HOURS;
  return safeHours * 60 * 60 * 1000;
}

function setStoredDownloads(
  chromeApi: typeof chrome,
  records: MobilePhotoDownloadRecord[],
) {
  return new Promise<boolean>((resolve) => {
    chromeApi.storage.local.set(
      { [MOBILE_PHOTO_DOWNLOADS_STORAGE_KEY]: records },
      () => resolve(!chromeApi.runtime.lastError),
    );
  });
}

function removeDownloadedFile(chromeApi: typeof chrome, downloadId: number) {
  return new Promise<{ success: true } | { success: false; error?: string }>(
    (resolve) => {
      chromeApi.downloads.removeFile(downloadId, () => {
        const error = chromeApi.runtime.lastError?.message;
        resolve(error ? { success: false, error } : { success: true });
      });
    },
  );
}

function eraseDownloadRecord(chromeApi: typeof chrome, downloadId: number) {
  return new Promise<void>((resolve) => {
    chromeApi.downloads.erase({ id: downloadId }, () => {
      resolve();
    });
  });
}

export function createMobilePhotoDownloadCleanup({
  chromeApi,
  log,
}: MobilePhotoDownloadCleanupOptions) {
  async function recordMobilePhotoDownload({
    downloadId,
    filename,
    downloadedAt = Date.now(),
  }: {
    downloadId: number;
    filename: string;
    downloadedAt?: number;
  }): Promise<MobilePhotoDownloadCleanupReceipt> {
    const settings = normalizeCleanupSettings(await getExtensionSettings(chromeApi));
    if (!settings.autoDeleteEnabled) {
      return { status: "not_applicable", reason: "auto_delete_disabled" };
    }
    if (!isVoltPhotoDownloadFilename(filename)) {
      return { status: "not_applicable", reason: "non_volt_filename" };
    }

    const current = await getStoredDownloads(chromeApi);
    const retentionMs = retentionHoursToMs(settings.retentionHours);
    const nextRecord = {
      downloadId,
      filename,
      downloadedAt,
      deleteAfter: downloadedAt + retentionMs,
    } satisfies MobilePhotoDownloadRecord;
    const next = [
      nextRecord,
      ...current.filter((record) => record.downloadId !== downloadId),
    ];
    const stored = await setStoredDownloads(chromeApi, next);
    return stored
      ? { status: "tracked" }
      : { status: "failed", error: "storage_failed" };
  }

  function ensureCleanupAlarm() {
    try {
      chromeApi.alarms?.create?.(MOBILE_PHOTO_DOWNLOAD_CLEANUP_ALARM_NAME, {
        when: nextMidnightTimestamp(),
        periodInMinutes: MOBILE_PHOTO_DOWNLOAD_CLEANUP_PERIOD_MINUTES,
      });
    } catch (error) {
      log(
        "Failed to create mobile photo download cleanup alarm",
        error instanceof Error ? error.message : error,
      );
    }
  }

  async function cleanupExpiredDownloads(now = Date.now()) {
    const settings = normalizeCleanupSettings(await getExtensionSettings(chromeApi));
    if (!settings.autoDeleteEnabled) {
      return { checked: 0, retained: 0, deleted: 0 };
    }

    const records = await getStoredDownloads(chromeApi);
    const retained: MobilePhotoDownloadRecord[] = [];

    for (const record of records) {
      if (!isVoltPhotoDownloadFilename(record.filename)) continue;
      if (record.deleteAfter > now) {
        retained.push(record);
        continue;
      }

      const removed = await removeDownloadedFile(chromeApi, record.downloadId);
      if (!removed.success) {
        retained.push(record);
        log("Failed to remove expired Volt photo download", {
          downloadId: record.downloadId,
          filename: record.filename,
          error: removed.error,
        });
        continue;
      }

      await eraseDownloadRecord(chromeApi, record.downloadId);
    }

    await setStoredDownloads(chromeApi, retained);
    return {
      checked: records.length,
      retained: retained.length,
      deleted: records.length - retained.length,
    };
  }

  return {
    alarmName: MOBILE_PHOTO_DOWNLOAD_CLEANUP_ALARM_NAME,
    cleanupExpiredDownloads,
    ensureCleanupAlarm,
    recordMobilePhotoDownload,
  };
}
