import { isTrustedExtensionPageSender, type ExtensionMessageSender } from "../access/sender-policy";
import { createWorkspaceSync } from "../cloud-scanner/workspace-sync.ts";

const ACTIVE_CLERK_SUBJECT_KEY = "volt.cloudScanner.activeClerkSubject.v1";
const WORKSPACE_OFFSCREEN_LIVENESS_ALARM = "volt.cloudScanner.offscreenLiveness";

type WorkspaceMessage =
  | { action: "workspaceCreateEnrollment"; label: string }
  | { action: "workspaceReconcile" }
  | { action: "workspaceGetPhotoDownload"; batchId: string; resultId: string }
  | { action: "workspaceDeleteResults"; resultIds: string[] }
  | { action: "workspaceRestoreResults"; resultIds: string[] };

type ControllerOptions = {
  chromeApi: typeof chrome;
  ensureOffscreenDocument: () => Promise<boolean>;
  handleCursorDeliveries: (deliveries: unknown) => Promise<void>;
  sendOffscreenMessage: (message: unknown) => Promise<unknown>;
  log?: (...args: unknown[]) => void;
};

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseMessage(value: unknown): WorkspaceMessage | null {
  const record = recordFrom(value);
  if (record?.action === "workspaceReconcile") return { action: record.action };
  if (record?.action === "workspaceGetPhotoDownload") {
    return typeof record.batchId === "string" && typeof record.resultId === "string"
      ? { action: record.action, batchId: record.batchId, resultId: record.resultId }
      : null;
  }
  if (record?.action === "workspaceDeleteResults" || record?.action === "workspaceRestoreResults") {
    const resultIds = Array.isArray(record.resultIds)
      ? record.resultIds.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, 100)
      : [];
    return resultIds.length > 0 ? { action: record.action, resultIds } : null;
  }
  if (record?.action !== "workspaceCreateEnrollment") return null;
  return {
    action: record.action,
    label: typeof record.label === "string" && record.label.trim()
      ? record.label.trim().slice(0, 80)
      : "Volt for iPhone",
  };
}

export function createCloudWorkspaceController(options: ControllerOptions) {
  const log = options.log ?? ((...args: unknown[]) => console.warn("[Volt Cloud Workspace]", ...args));
  // Shared with the sidepanel, which subscribes to Convex itself; the sync
  // module serializes both writers so either context can apply a snapshot.
  const sync = createWorkspaceSync({
    chromeApi: options.chromeApi,
    getPhotoDownload: (batchId, resultId) => getPhotoDownload(batchId, resultId),
  });

  async function relayOffscreenOperation(message: unknown) {
    const response = await options.sendOffscreenMessage(message);
    const record = recordFrom(response);
    if (record?.success !== true) {
      throw new Error(
        typeof record?.error === "string"
          ? record.error
          : "Cloud workspace operation failed.",
      );
    }
    return record.value;
  }

  async function createEnrollment(label: string) {
    const payload = await relayOffscreenOperation({
      action: "workspaceOffscreenCreateEnrollment",
      label,
    });
    const record = recordFrom(payload);
    const enrollmentCode = typeof record?.enrollmentCode === "string" ? record.enrollmentCode : null;
    const expiresAt = typeof record?.expiresAt === "number" ? record.expiresAt : null;
    if (!enrollmentCode || expiresAt === null) throw new Error("Enrollment response omitted required fields.");
    return {
      enrollmentCode,
      enrollmentUrl: `volt://enroll?enrollmentToken=${encodeURIComponent(enrollmentCode)}`,
      expiresAt,
    };
  }

  async function reconcileWorkspace() {
    const response = await options.sendOffscreenMessage({
      action: "workspaceOffscreenReconcile",
    });
    const record = recordFrom(response);
    if (record?.success !== true) {
      throw new Error(
        typeof record?.error === "string"
          ? record.error
          : "Cloud workspace reconciliation failed.",
      );
    }
    if (record.snapshot === undefined || record.snapshot === null) return null;
    return sync.applySnapshot(record.snapshot);
  }

  function handleAccountChanged(subject: string | null) {
    return sync.runExclusive(async ({ resetActiveHistory }) => {
      const stored = await options.chromeApi.storage.local.get(ACTIVE_CLERK_SUBJECT_KEY);
      const previousSubject = stored[ACTIVE_CLERK_SUBJECT_KEY];
      const didChange = typeof previousSubject === "string" && previousSubject !== subject;
      const didSignOut = subject === null && typeof previousSubject === "string";
      if (didChange || didSignOut) await resetActiveHistory();
      if (subject === null) {
        await options.chromeApi.storage.local.remove(ACTIVE_CLERK_SUBJECT_KEY);
        return;
      }
      await options.chromeApi.storage.local.set({ [ACTIVE_CLERK_SUBJECT_KEY]: subject });
    });
  }

  async function getPhotoDownload(batchId: string, resultId: string) {
    const payload = await relayOffscreenOperation({
      action: "workspaceOffscreenCreatePhotoDownloadUrl",
      batchId,
      resultId,
    });
    const record = recordFrom(payload);
    if (typeof record?.url !== "string" || (record.method !== undefined && record.method !== "GET")) {
      throw new Error("Photo download response was invalid.");
    }
    const headers = recordFrom(record.headers) ?? {};
    return {
      url: record.url,
      headers: Object.fromEntries(
        Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
      expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : undefined,
    };
  }

  function deleteResults(resultIds: string[]) {
    return relayOffscreenOperation({
      action: "workspaceOffscreenDeleteResults",
      resultIds,
    });
  }

  function restoreResults(resultIds: string[]) {
    return relayOffscreenOperation({
      action: "workspaceOffscreenRestoreResults",
      resultIds,
    });
  }

  function handleMessage(
    rawMessage: unknown,
    sender: ExtensionMessageSender,
    sendResponse: (response?: unknown) => void,
  ) {
    const rawRecord = recordFrom(rawMessage);
    const isOffscreenMessage =
      rawRecord?.action === "workspaceOffscreenSnapshotChanged"
      || rawRecord?.action === "workspaceOffscreenCursorDeliveriesChanged"
      || rawRecord?.action === "workspaceOffscreenAccountChanged";
    if (isOffscreenMessage) {
      if (!isTrustedExtensionPageSender(
        sender,
        options.chromeApi.runtime.id,
        ["/offscreen.html"],
      )) {
        sendResponse({ success: false, error: "unauthorized_extension_sender" });
        return true;
      }
      const operation = rawRecord.action === "workspaceOffscreenSnapshotChanged"
        ? sync.applySnapshot(rawRecord.snapshot)
        : rawRecord.action === "workspaceOffscreenCursorDeliveriesChanged"
          ? options.handleCursorDeliveries(rawRecord.deliveries)
          : handleAccountChanged(typeof rawRecord.subject === "string" ? rawRecord.subject : null);
      void operation
        .then((value) => sendResponse({ success: true, value }))
        .catch((error: unknown) => sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      return true;
    }

    const message = parseMessage(rawMessage);
    if (!message) return false;
    if (!isTrustedExtensionPageSender(
      sender,
      options.chromeApi.runtime.id,
      ["/mobile-scanner-popup.html", "/sidepanel.html"],
    )) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return true;
    }
    const operation = (() => {
      switch (message.action) {
        case "workspaceCreateEnrollment": return createEnrollment(message.label);
        case "workspaceReconcile": return reconcileWorkspace();
        case "workspaceGetPhotoDownload": return getPhotoDownload(message.batchId, message.resultId);
        case "workspaceDeleteResults": return deleteResults(message.resultIds);
        case "workspaceRestoreResults": return restoreResults(message.resultIds);
      }
    })();
    void operation
      .then((value) => sendResponse({ success: true, value }))
      .catch((error: unknown) => sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }

  // Creating the offscreen document is not enough on its own: it can survive
  // while its Convex subscriptions are gone (a failed start, a torn-down
  // socket, an auth pass that stopped them). start() is idempotent, so the
  // liveness heartbeat re-asserts them rather than waiting for a service
  // worker restart.
  async function startSubscriptions() {
    try {
      const response = await options.sendOffscreenMessage({
        action: "workspaceOffscreenStartSubscriptions",
      });
      const record = recordFrom(response);
      if (record?.success !== true) {
        const detail = typeof record?.error === "string" ? record.error : "no_response";
        log("Workspace subscription start failed", detail);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log("Workspace subscription start failed", detail);
    }
  }

  return {
    alarmName: WORKSPACE_OFFSCREEN_LIVENESS_ALARM,
    handleAlarm: async () => {
      const ready = await options.ensureOffscreenDocument();
      if (ready) await startSubscriptions();
      return ready;
    },
    handleMessage,
    initialize: async () => {
      // Upgraded installs may still carry the retired HTTP-heartbeat alarm.
      await options.chromeApi.alarms.clear("volt.cloudScanner.computerPresence").catch(() => false);
      await options.chromeApi.alarms.create(WORKSPACE_OFFSCREEN_LIVENESS_ALARM, {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
      await startSubscriptions();
    },
  };
}
