import { createClerkClient } from "@clerk/chrome-extension/client";
import {
  accessStatusFromPayload,
  errorMessageFromPayload,
  type AccessRequestResult,
  type ExtensionAccessStatus,
} from "../access/access-contract";
import { CLERK_PUBLISHABLE_KEY, VOLT_FULL_APP_URL } from "../access/config";
import {
  isTrustedExtensionPageSender,
  type ExtensionMessageSender,
} from "../access/sender-policy";
import {
  connectedUsageSession,
  getOrCreateUsageSession,
  parseStoredUsageSession,
  type StoredUsageSession,
} from "../access/usage-session";

const ANONYMOUS_CREDENTIALS_KEY = "volt.access.anonymousCredentials";
const ACTIVE_USAGE_SESSION_KEY = "volt.access.activeUsageSession";
const ACCESS_HARD_STOP_ALARM = "volt.access.sessionHardStop";

type LogFn = (...args: unknown[]) => void;

type AnonymousCredentials = {
  anonymousId: string;
  anonymousSecret: string;
};

type AccessControllerOptions = {
  chromeApi: typeof chrome;
  disconnectScanner: () => Promise<unknown>;
  log: LogFn;
  signalUrl: string;
};

type AccessSender = ExtensionMessageSender;

type AccessMessage =
  | { action: "accessGetStatus" }
  | { action: "accessAuthChanged" }
  | { action: "accessOpenFullApp" }
  | {
      action: "accessCreateJoinWindow";
      sessionId: string;
      ttlMs: number;
      target?: unknown;
      deviceLabel?: string;
      capabilities?: string[];
    }
  | {
      action: "accessSessionReady";
      joinToken: string;
      usageSessionId: string;
    }
  | { action: "accessSessionDisconnected"; usageSessionId: string }
  | { action: "accessSessionEnded"; usageSessionId: string };

type SendResponse = (response?: unknown) => void;

type JsonResponse = {
  payload: unknown;
  response: Response;
};

function objectFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function parseAccessMessage(value: unknown): AccessMessage | null {
  const record = objectFrom(value);
  if (!record || typeof record.action !== "string") return null;

  switch (record.action) {
    case "accessGetStatus":
    case "accessAuthChanged":
    case "accessOpenFullApp":
      return { action: record.action };
    case "accessCreateJoinWindow": {
      const sessionId = nonEmptyString(record.sessionId);
      const ttlMs = finiteNumber(record.ttlMs);
      if (!sessionId || ttlMs === null) return null;
      return {
        action: record.action,
        sessionId,
        ttlMs,
        target: record.target,
        deviceLabel: nonEmptyString(record.deviceLabel) ?? undefined,
        capabilities: stringArray(record.capabilities),
      };
    }
    case "accessSessionReady": {
      const joinToken = nonEmptyString(record.joinToken);
      const usageSessionId = nonEmptyString(record.usageSessionId);
      return joinToken && usageSessionId
        ? { action: record.action, joinToken, usageSessionId }
        : null;
    }
    case "accessSessionDisconnected":
    case "accessSessionEnded": {
      const usageSessionId = nonEmptyString(record.usageSessionId);
      return usageSessionId
        ? { action: record.action, usageSessionId }
        : null;
    }
    default:
      return null;
  }
}

function timestampFromPayload(payload: unknown, key: string) {
  const record = objectFrom(payload);
  const nested = objectFrom(record?.session);
  const value = record?.[key] ?? nested?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createAccessController({
  chromeApi,
  disconnectScanner,
  log,
  signalUrl,
}: AccessControllerOptions) {
  async function freshClerkClient() {
    if (!CLERK_PUBLISHABLE_KEY) return null;
    try {
      return await createClerkClient({
        publishableKey: CLERK_PUBLISHABLE_KEY,
        background: true,
      })
    } catch (error) {
      log(
        "Failed to load the current Clerk session in the service worker",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
  let anonymousRegistration: Promise<void> | null = null;

  async function getClerkToken() {
    const clerk = await freshClerkClient();
    return clerk?.session?.getToken({
      template: "convex",
      organizationId: clerk.organization?.id,
    }) ?? null;
  }

  function accessUrl(path: string) {
    const url = new URL(signalUrl);
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async function anonymousCredentials(): Promise<AnonymousCredentials | null> {
    const stored = await chromeApi.storage.local.get(ANONYMOUS_CREDENTIALS_KEY);
    const candidate = objectFrom(stored[ANONYMOUS_CREDENTIALS_KEY]);
    const anonymousId = nonEmptyString(candidate?.anonymousId);
    const anonymousSecret = nonEmptyString(candidate?.anonymousSecret);
    if (anonymousId && anonymousSecret) return { anonymousId, anonymousSecret };
    return null;
  }

  async function requestHeaders(hasBody: boolean, includeAnonymous: boolean) {
    const anonymous = includeAnonymous ? await anonymousCredentials() : null;
    const headers = new Headers({ Accept: "application/json" });
    if (anonymous) {
      headers.set("X-Volt-Anonymous-Id", anonymous.anonymousId);
      headers.set("X-Volt-Anonymous-Secret", anonymous.anonymousSecret);
    }
    if (hasBody) headers.set("Content-Type", "application/json");

    // A fresh background client reloads the latest sign-in and organization
    // selection from Clerk's SDK-managed extension storage for every request.
    const token = await getClerkToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  async function requestJson(
    url: string,
    init: {
      method: "GET" | "POST";
      body?: unknown;
      includeAnonymous?: boolean;
    },
  ): Promise<JsonResponse> {
    const hasBody = init.body !== undefined;
    const response = await fetch(url, {
      method: init.method,
      headers: await requestHeaders(
        hasBody,
        init.includeAnonymous !== false,
      ),
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    return { payload, response };
  }

  async function ensureAnonymousRegistered(force = false) {
    if (!force && anonymousRegistration) return anonymousRegistration;
    anonymousRegistration = (async () => {
      const existing = await anonymousCredentials();
      const { payload, response } = await requestJson(
        accessUrl("/api/access/anonymous"),
        {
          method: "POST",
          body: {},
          includeAnonymous: Boolean(existing),
        },
      );
      if (!response.ok) {
        throw new Error(
          errorMessageFromPayload(
            payload,
            `Anonymous access registration failed (${response.status})`,
          ),
        );
      }
      if (existing) return;

      const record = objectFrom(payload);
      const anonymousId = nonEmptyString(record?.anonymousId);
      const anonymousSecret = nonEmptyString(record?.anonymousSecret);
      if (!anonymousId || !anonymousSecret) {
        throw new Error("Anonymous access response omitted credentials");
      }
      await chromeApi.storage.local.set({
        [ANONYMOUS_CREDENTIALS_KEY]: { anonymousId, anonymousSecret },
      });
    })();
    try {
      await anonymousRegistration;
    } catch (error) {
      anonymousRegistration = null;
      throw error;
    }
  }

  async function fetchAccessStatus(): Promise<ExtensionAccessStatus> {
    await ensureAnonymousRegistered();
    const { payload, response } = await requestJson(
      accessUrl("/api/access/status"),
      { method: "GET" },
    );
    const status = accessStatusFromPayload(payload);
    if (!response.ok || !status) {
      throw new Error(
        errorMessageFromPayload(
          payload,
          `Unable to load access status (${response.status})`,
        ),
      );
    }
    return status;
  }

  async function currentUsageSession() {
    const stored = await chromeApi.storage.local.get(ACTIVE_USAGE_SESSION_KEY);
    return parseStoredUsageSession(stored[ACTIVE_USAGE_SESSION_KEY]);
  }

  async function saveUsageSession(session: StoredUsageSession) {
    await chromeApi.storage.local.set({ [ACTIVE_USAGE_SESSION_KEY]: session });
  }

  async function clearUsageSession() {
    await chromeApi.storage.local.remove(ACTIVE_USAGE_SESSION_KEY);
    await chromeApi.alarms.clear(ACCESS_HARD_STOP_ALARM);
  }

  async function usageSessionForJoin() {
    const current = await currentUsageSession();
    const selected = getOrCreateUsageSession(current, () => crypto.randomUUID());
    if (selected !== current) await saveUsageSession(selected);
    return selected;
  }

  async function broadcastAccessStatus(status?: ExtensionAccessStatus) {
    const nextStatus = status ?? (await fetchAccessStatus().catch(() => null));
    if (!nextStatus) return;
    await chromeApi.runtime
      .sendMessage({ action: "accessStatusChanged", status: nextStatus })
      .catch(() => undefined);
  }

  async function failedResult(
    payload: unknown,
    response: Response,
    fallback: string,
  ): Promise<AccessRequestResult<never>> {
    return {
      success: false,
      error: errorMessageFromPayload(payload, fallback),
      statusCode: response.status,
      accessStatus: accessStatusFromPayload(payload) ?? undefined,
    };
  }

  async function createJoinWindow(
    message: Extract<AccessMessage, { action: "accessCreateJoinWindow" }>,
  ): Promise<AccessRequestResult<Record<string, unknown>>> {
    await ensureAnonymousRegistered();
    const usageSession = await usageSessionForJoin();
    const { payload, response } = await requestJson(
      accessUrl("/api/signal/join-token"),
      {
        method: "POST",
        body: {
          transport: "webrtc",
          webRtcOnly: true,
          role: "browser",
          sessionId: message.sessionId,
          usageSessionId: usageSession.usageSessionId,
          ttlMs: message.ttlMs,
          target: message.target,
          deviceLabel: message.deviceLabel,
          capabilities: message.capabilities,
        },
      },
    );
    const record = objectFrom(payload);
    if (!response.ok || !record) {
      return failedResult(
        payload,
        response,
        `Failed to create scanner join window (${response.status})`,
      );
    }
    const joinToken =
      nonEmptyString(record.token) ?? nonEmptyString(record.joinToken);
    const returnedSessionId = nonEmptyString(record.sessionId);
    const qrCodeUrl = nonEmptyString(record.qrCodeUrl);
    if (!joinToken || !returnedSessionId || !qrCodeUrl) {
      return {
        success: false,
        error: "Scanner join response omitted required fields",
      };
    }
    return {
      success: true,
      value: {
        token: joinToken,
        sessionId: returnedSessionId,
        usageSessionId: usageSession.usageSessionId,
        qrCodeUrl,
        ...(nonEmptyString(record.expiresAt)
          ? { expiresAt: record.expiresAt }
          : {}),
      },
      accessStatus: accessStatusFromPayload(payload) ?? undefined,
    };
  }

  async function scheduleHardStop(session: StoredUsageSession) {
    if (!session.maxEndsAt) return;
    await chromeApi.alarms.create(ACCESS_HARD_STOP_ALARM, {
      when: session.maxEndsAt,
    });
  }

  async function sessionReady(
    message: Extract<AccessMessage, { action: "accessSessionReady" }>,
  ): Promise<AccessRequestResult<Record<string, unknown>>> {
    await ensureAnonymousRegistered();
    const { payload, response } = await requestJson(
      accessUrl(
        `/api/signal/join-token/${encodeURIComponent(message.joinToken)}/session-ready`,
      ),
      {
        method: "POST",
        body: { usageSessionId: message.usageSessionId },
      },
    );
    const record = objectFrom(payload);
    if (!response.ok || !record) {
      if (response.status === 409 || response.status === 410) {
        await clearUsageSession();
      }
      return failedResult(
        payload,
        response,
        `Unable to start scanner work session (${response.status})`,
      );
    }

    const current =
      (await currentUsageSession()) ?? {
        usageSessionId: message.usageSessionId,
        createdAt: Date.now(),
      };
    const connected = connectedUsageSession(current, {
      startedAt: timestampFromPayload(payload, "startedAt"),
      maxEndsAt: timestampFromPayload(payload, "maxEndsAt"),
    });
    await saveUsageSession(connected);
    await scheduleHardStop(connected);
    const accessStatus = accessStatusFromPayload(payload) ?? undefined;
    void broadcastAccessStatus(accessStatus);
    return {
      success: true,
      value: { usageSessionId: connected.usageSessionId },
      accessStatus,
    };
  }

  async function updateSession(
    operation: "disconnect" | "end",
    usageSessionId: string,
  ) {
    const current = await currentUsageSession();
    if (operation === "disconnect" && current?.usageSessionId === usageSessionId) {
      await saveUsageSession({ ...current, disconnectedAt: Date.now() });
    }
    const requestResult = await requestJson(
      accessUrl(`/api/access/session/${operation}`),
      { method: "POST", body: { usageSessionId } },
    ).finally(() =>
      operation === "end" ? clearUsageSession() : Promise.resolve(),
    );
    const { payload, response } = requestResult;
    if (!response.ok) {
      return failedResult(
        payload,
        response,
        `Unable to ${operation} scanner work session (${response.status})`,
      );
    }
    const status = accessStatusFromPayload(payload) ?? undefined;
    void broadcastAccessStatus(status);
    return {
      success: true,
      value: { usageSessionId },
      accessStatus: status,
    } satisfies AccessRequestResult<Record<string, unknown>>;
  }

  async function handleHardStop() {
    const current = await currentUsageSession();
    if (!current?.maxEndsAt) return;
    if (current.maxEndsAt > Date.now()) {
      await scheduleHardStop(current);
      return;
    }

    const closeScanner = disconnectScanner().catch((error) => {
      log(
        "Failed to close scanner at its eight-hour limit",
        error instanceof Error ? error.message : error,
      );
    });
    const endUsage = updateSession("end", current.usageSessionId).catch(
      (error) => {
        log(
          "Failed to end scanner session at its eight-hour limit",
          error instanceof Error ? error.message : error,
        );
      },
    );
    await Promise.all([closeScanner, endUsage]);
  }

  function senderAllowed(message: AccessMessage, sender: AccessSender) {
    const internalPages = [
      "/mobile-scanner-popup.html",
      "/sidepanel.html",
    ] as const;
    const offscreenPages = ["/offscreen.html"] as const;
    if (
      message.action === "accessGetStatus" ||
      message.action === "accessAuthChanged" ||
      message.action === "accessOpenFullApp"
    ) {
      return isTrustedExtensionPageSender(
        sender,
        chromeApi.runtime.id,
        internalPages,
      );
    }
    return isTrustedExtensionPageSender(
      sender,
      chromeApi.runtime.id,
      offscreenPages,
    );
  }

  function handleMessage(
    rawMessage: unknown,
    sender: AccessSender,
    sendResponse: SendResponse,
  ) {
    const message = parseAccessMessage(rawMessage);
    if (!message) return false;
    if (!senderAllowed(message, sender)) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return true;
    }

    const operation = (async () => {
      switch (message.action) {
        case "accessGetStatus":
          return { success: true, status: await fetchAccessStatus() };
        case "accessAuthChanged":
          await ensureAnonymousRegistered(true);
          return { success: true, status: await fetchAccessStatus() };
        case "accessOpenFullApp":
          await chromeApi.tabs.create({ url: VOLT_FULL_APP_URL, active: true });
          return { success: true };
        case "accessCreateJoinWindow":
          return createJoinWindow(message);
        case "accessSessionReady":
          return sessionReady(message);
        case "accessSessionDisconnected":
          return updateSession("disconnect", message.usageSessionId);
        case "accessSessionEnded":
          return updateSession("end", message.usageSessionId);
      }
    })();

    void operation.then(sendResponse).catch((error: unknown) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return true;
  }

  async function resumeHardStopAlarm() {
    const current = await currentUsageSession();
    if (!current?.maxEndsAt) return;
    if (current.maxEndsAt <= Date.now()) {
      await handleHardStop();
      return;
    }
    await scheduleHardStop(current);
  }

  return {
    alarmName: ACCESS_HARD_STOP_ALARM,
    getClerkToken,
    handleAlarm: handleHardStop,
    handleMessage,
    initialize: async () => {
      await ensureAnonymousRegistered().catch((error) => {
        log(
          "Failed to initialize anonymous scanner access",
          error instanceof Error ? error.message : error,
        );
      });
      await resumeHardStopAlarm();
    },
  };
}
