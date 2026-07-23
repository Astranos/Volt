import { isTrustedExtensionPageSender, type ExtensionMessageSender } from "../access/sender-policy";
import { chromeLocalKeyValueStorage, createWorkspaceStore } from "../cloud-scanner/workspace-store.ts";
import { normalizeWorkspaceSnapshot } from "../cloud-scanner/workspace-snapshot.ts";
import { getMobileScannerExtensionIdentity } from "../domain/mobile-scanner-identity";

const COMPUTER_REGISTRATION_KEY = "volt.cloudScanner.computerRegistration.v1";
const COMPUTER_PRESENCE_ALARM = "volt.cloudScanner.computerPresence";
const COMPUTER_PRESENCE_TTL_MS = 2 * 60 * 1000;

type WorkspaceMessage =
  | { action: "workspaceCreateEnrollment"; label: string; clerkToken: string }
  | { action: "workspaceGetSnapshot" }
  | { action: "workspaceGetPhotoDownload"; batchId: string; resultId: string }
  | { action: "workspaceDeleteResults"; resultIds: string[] }
  | { action: "workspaceRestoreResults"; resultIds: string[] };

type ControllerOptions = {
  chromeApi: typeof chrome;
  getClerkToken: () => Promise<string | null>;
  siteUrl: string;
};

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseMessage(value: unknown): WorkspaceMessage | null {
  const record = recordFrom(value);
  if (record?.action === "workspaceGetSnapshot") return { action: record.action };
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
  if (typeof record.clerkToken !== "string" || !record.clerkToken) return null;
  return {
    action: record.action,
    label: typeof record.label === "string" && record.label.trim()
      ? record.label.trim().slice(0, 80)
      : "Volt for iPhone",
    clerkToken: record.clerkToken,
  };
}

export function createCloudWorkspaceController(options: ControllerOptions) {
  const store = createWorkspaceStore(chromeLocalKeyValueStorage(options.chromeApi));

  function routeUrl(path: string) {
    const url = new URL(options.siteUrl);
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url;
  }

  async function request(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
    clerkToken?: string,
  ) {
    const token = clerkToken || await options.getClerkToken();
    if (!token) throw new Error("Sign in to enroll Volt for iPhone.");
    const response = await fetch(routeUrl(path), {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const record = recordFrom(payload);
      throw new Error(typeof record?.error === "string" ? record.error : `Workspace request failed (${response.status})`);
    }
    return payload;
  }

  async function createEnrollment(label: string, clerkToken: string) {
    await registerComputer(clerkToken);
    const payload = await request("/api/workspace/enrollment", "POST", { kind: "ios", label }, clerkToken);
    const record = recordFrom(payload);
    const enrollmentCode = typeof record?.enrollmentCode === "string" ? record.enrollmentCode : null;
    const expiresAt = typeof record?.expiresAt === "number" ? record.expiresAt : null;
    if (!enrollmentCode || expiresAt === null) throw new Error("Enrollment response omitted required fields.");
    const enrollmentUrl = typeof record?.enrollmentUrl === "string"
      ? record.enrollmentUrl
      : `volt://enroll?enrollmentToken=${encodeURIComponent(enrollmentCode)}`;
    return { enrollmentCode, enrollmentUrl, expiresAt };
  }

  async function getSnapshot() {
    await registerComputer();
    const payload = await request("/api/workspace/snapshot", "GET");
    const page = normalizeWorkspaceSnapshot(payload);
    if (!page) throw new Error("Workspace snapshot was invalid.");
    return store.mergePage(page);
  }

  async function getPhotoDownload(batchId: string, resultId: string) {
    const payload = await request("/api/workspace/photos/download-url", "POST", { batchId, resultId });
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

  async function deleteResults(resultIds: string[]) {
    return request("/api/workspace/results/delete", "POST", { resultIds });
  }

  async function restoreResults(resultIds: string[]) {
    return request("/api/workspace/results/restore", "POST", { resultIds });
  }

  async function registerComputer(clerkToken?: string) {
    const identity = await getMobileScannerExtensionIdentity();
    const payload = await request("/api/workspace/computers/register", "POST", {
      installationId: identity.installId,
      label: identity.sessionLabel,
      capabilities: ["workspace-results", "cursor-insertion", "dictation"],
      ttlMs: COMPUTER_PRESENCE_TTL_MS,
    }, clerkToken);
    const record = recordFrom(payload);
    if (
      typeof record?.deviceId !== "string" ||
      typeof record.workspaceId !== "string" ||
      typeof record.registrationId !== "string" ||
      typeof record.expiresAt !== "number"
    ) throw new Error("Computer registration response was invalid.");
    const registration = {
      deviceId: record.deviceId,
      workspaceId: record.workspaceId,
      registrationId: record.registrationId,
      expiresAt: record.expiresAt,
    };
    await options.chromeApi.storage.local.set({ [COMPUTER_REGISTRATION_KEY]: registration });
    return registration;
  }

  function handleMessage(
    rawMessage: unknown,
    sender: ExtensionMessageSender,
    sendResponse: (response?: unknown) => void,
  ) {
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
        case "workspaceCreateEnrollment": return createEnrollment(message.label, message.clerkToken);
        case "workspaceGetSnapshot": return getSnapshot();
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

  return {
    alarmName: COMPUTER_PRESENCE_ALARM,
    handleAlarm: async () => {
      await registerComputer().catch(() => undefined);
    },
    handleMessage,
    initialize: async () => {
      await options.chromeApi.alarms.create(COMPUTER_PRESENCE_ALARM, {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
      await registerComputer().catch(() => undefined);
    },
  };
}
