import { httpRouter, makeFunctionReference } from "convex/server";
import type { Infer } from "convex/values";
import {
  SCANNER_STUN_ONLY_ICE_SERVERS,
  buildScannerIceServersResponse,
  normalizeScannerIceServers,
  scannerStunOnlyIceServersResponse,
} from "@volt/scanner-protocol";

import { httpAction, type ActionCtx } from "./_generated/server";
import {
  AI_SCANNER_MAX_IMAGE_BYTES,
  AIScannerError,
  requestOpenRouterAnalysis,
  type AIScannerCatalogMatch,
  type AIScannerMode,
  type AIScannerTraceEvent,
  type ProductIdentity,
} from "./aiScanner";
import {
  type AIScannerQuotaError,
  type AIScannerReservation,
} from "./aiScannerQuota";
import {
  clerkAuthContextFromIdentity,
  type ClerkAuthContext,
} from "./access";
import {
  browserClaimFrom,
  pairingSecretFrom,
  type SignalRequestBody,
  signalBodyFromRequest,
  signalPartsFromRequest,
  stringFrom,
} from "./scannerSignal/httpAdapter";
import {
  logScannerSignalEvent,
  scannerSignalEventForCommand,
  scannerSignalIdTail,
  scannerSignalRouteTemplate,
  type ScannerSignalLogFields,
} from "./scannerSignal/logging";
import { executeScannerSignalRendezvous } from "./scannerSignal/rendezvous";
import { signalRouteCommand } from "./scannerSignal/routeCommands";
import type { SignalRouteCommand } from "./scannerSignal/routeCommands";
import { hasProductApiKeyFormat, sha256Hex } from "./productApiKeyCrypto";
import {
  catalogSummaryValidator,
  storedCatalogProductValidator,
} from "./catalog/validators";

const http = httpRouter();
const CLOUDFLARE_TURN_GENERATE_ICE_SERVERS_BASE_URL = "https://rtc.live.cloudflare.com/v1/turn/keys";
const DEFAULT_CLOUDFLARE_TURN_TTL_SECONDS = 86_400;
const STUN_FALLBACK_TTL_SECONDS = 300;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Volt-Anonymous-Id, X-Volt-Anonymous-Secret, X-Volt-Browser-Claim, X-Volt-Pairing-Secret, X-Volt-Device-Id, X-Volt-Device-Secret",
  "Access-Control-Expose-Headers":
    "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After",
  "Cache-Control": "no-store",
};

function jsonResponse(body: unknown, status = 200, additionalHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...additionalHeaders, "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status, headers: corsHeaders });
}

function objectFrom(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringField(value: unknown, key: string) {
  const field = objectFrom(value)[key];
  return typeof field === "string" ? field : undefined;
}

function scannerSignalLogFields(
  command: SignalRouteCommand,
  parts: string[],
  body: SignalRequestBody,
  responseBody: unknown,
  statusCode: number,
  startedAt: number,
): ScannerSignalLogFields {
  const response = objectFrom(responseBody);
  const attempt = objectFrom(response.attempt);
  const request = objectFrom(response.request);
  const requests = Array.isArray(response.requests) ? response.requests : undefined;
  const isPairingIdRoute = parts[0] === "pairings" && parts[1] !== "reconnect-requests";

  return {
    route: scannerSignalRouteTemplate(command),
    command,
    statusCode,
    elapsedMs: Date.now() - startedAt,
    tokenTail: scannerSignalIdTail(parts[0] === "join-token" ? parts[1] : response.token ?? response.joinToken),
    attemptIdTail: scannerSignalIdTail(parts[3] ?? attempt.id),
    pairingIdTail: scannerSignalIdTail((isPairingIdRoute ? parts[1] : undefined) ?? response.pairingId ?? body.pairingId),
    requestIdTail: scannerSignalIdTail(parts[3] ?? request.id ?? response.requestId),
    browserSessionIdTail: scannerSignalIdTail(response.browserSessionId ?? body.browserSessionId ?? body.sessionId),
    requestCount: requests?.length,
  };
}

function rejectionReason(responseBody: unknown) {
  const reason = stringField(responseBody, "error");
  return reason ? reason.slice(0, 120) : undefined;
}

function logScannerSignalResponse(
  command: SignalRouteCommand,
  parts: string[],
  body: SignalRequestBody,
  responseBody: unknown,
  statusCode: number,
  startedAt: number,
) {
  const fields = scannerSignalLogFields(command, parts, body, responseBody, statusCode, startedAt);
  if (statusCode >= 400) {
    logScannerSignalEvent("signal_rejected", { ...fields, reason: rejectionReason(responseBody) }, "warn");
    return;
  }

  const event = scannerSignalEventForCommand(command);
  if (event) logScannerSignalEvent(event, fields);
}

async function runAndRespond<T extends { statusCode: number; body: unknown }>(
  result: Promise<T>,
  logContext?: {
    command: SignalRouteCommand;
    parts: string[];
    requestBody: SignalRequestBody;
    startedAt: number;
  },
) {
  const response = await result;
  if (logContext) {
    logScannerSignalResponse(
      logContext.command,
      logContext.parts,
      logContext.requestBody,
      response.body,
      response.statusCode,
      logContext.startedAt,
    );
  }
  return jsonResponse(response.body, response.statusCode);
}

type AccessHttpArgs = ClerkAuthContext & {
  anonymousId?: string;
  anonymousSecret?: string;
};

type AccessHttpResult = { statusCode: number; body: unknown };

const anonymousTrialForHttp = makeFunctionReference<
  "mutation",
  AccessHttpArgs,
  AccessHttpResult
>("access:anonymousTrialForHttp");
const getStatusForHttp = makeFunctionReference<
  "mutation",
  AccessHttpArgs,
  AccessHttpResult
>("access:getStatusForHttp");
const disconnectSessionForHttp = makeFunctionReference<
  "mutation",
  AccessHttpArgs & { usageSessionId: string },
  AccessHttpResult
>("access:disconnectSessionForHttp");
const endSessionForHttp = makeFunctionReference<
  "mutation",
  AccessHttpArgs & { usageSessionId: string },
  AccessHttpResult
>("access:endSessionForHttp");
const syncStoreKitForHttp = makeFunctionReference<
  "action",
  ClerkAuthContext & { signedTransaction: string },
  AccessHttpResult
>("storeKit:syncForHttp");
const acceptStoreKitNotification = makeFunctionReference<
  "action",
  { signedPayload: string },
  AccessHttpResult
>("storeKit:acceptNotification");
type ProductSummary = Infer<typeof catalogSummaryValidator>;
type StoredCatalogProduct = Infer<typeof storedCatalogProductValidator>;
type ProductSearchResult = {
  page: ProductSummary[];
  isDone: boolean;
  continueCursor: string;
};
type ProductApiAuthorizationResult =
  | {
      kind: "authorized";
      limit: number;
      remaining: number;
      resetAt: number;
    }
  | { kind: "invalid_key" }
  | {
      kind: "rate_limited";
      limit: number;
      remaining: number;
      resetAt: number;
      retryAfterSeconds: number;
    };
const authenticateProductApiKey = makeFunctionReference<
  "mutation",
  { keyHash: string; now: number },
  ProductApiAuthorizationResult
>("productApiKeys:authenticateAndConsume");
const searchProductsForApi = makeFunctionReference<
  "query",
  {
    searchQuery?: string;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  ProductSearchResult
>("productData:searchProductsForApi");
const getProductByUpcForApi = makeFunctionReference<
  "query",
  { upc: string },
  StoredCatalogProduct | null
>("productData:getProductByUpcForApi");
type CloudResultInput = {
  resultId: string;
  kind: "text" | "barcode" | "photo" | "dictation";
  text?: string;
  format?: string;
  contentType?: string;
  byteCount: number;
  checksum?: string;
  clientCreatedAt: number;
};
const exchangeWorkspaceEnrollment = makeFunctionReference<
  "mutation",
  { enrollmentCode: string; label?: string },
  { deviceId: string; deviceSecret: string; workspaceId: string }
>("cloudWorkspace:exchangeEnrollment");
const bootstrapMobileDevice = makeFunctionReference<
  "mutation",
  { installationId: string; label: string; existingDeviceId?: string },
  { deviceId: string; deviceSecret: string; workspaceId: string; clerkUserId: string }
>("cloudWorkspace:bootstrapMobileDevice");
type MobileComputer = {
  deviceId: string;
  label: string;
  capabilities: string[];
  online: boolean;
};
const listMobileComputers = makeFunctionReference<
  "query",
  { deviceId: string; deviceSecret: string },
  { cursorTargetDeviceId: string | null; computers: MobileComputer[] }
>("cloudWorkspace:listComputersForDevice");
const listAppClipComputers = makeFunctionReference<
  "query", { guestCloudGrant: string }, { computers: MobileComputer[] }
>("cloudWorkspace:listComputersForGuest");
const setMobileCursorTarget = makeFunctionReference<
  "mutation",
  { deviceId: string; deviceSecret: string; cursorTargetDeviceId: string | null },
  { cursorTargetDeviceId: string | null }
>("cloudWorkspace:setCursorTarget");
const queueMobileCursorDelivery = makeFunctionReference<
  "mutation",
  {
    deviceId: string;
    deviceSecret: string;
    deliveryId: string;
    resultId: string;
    targetDeviceId: string;
    kind: "barcode" | "text";
    text: string;
    format?: string;
    clientCreatedAt: number;
  },
  { deliveryId: string; idempotent: boolean; state: "pending" | "delivered" | "failed" }
>("cloudWorkspace:queueCursorDelivery");
const queueAppClipCursorDelivery = makeFunctionReference<
  "mutation",
  {
    guestCloudGrant: string; deliveryId: string; resultId: string;
    targetDeviceId: string; kind: "barcode" | "text"; text: string;
    format?: string; clientCreatedAt: number;
  },
  { deliveryId: string; idempotent: boolean; state: "pending" | "delivered" | "failed" }
>("cloudWorkspace:queueGuestCursorDelivery");
const cursorDeliveryStatus = makeFunctionReference<
  "query",
  { deviceId: string; deviceSecret: string; deliveryIds: string[] },
  {
    statuses: Array<{
      deliveryId: string;
      state: "pending" | "delivered" | "failed";
      errorCode?: string;
      deliveredAt?: number;
    }>;
  }
>("cloudWorkspace:cursorDeliveryStatus");
const putCloudBatch = makeFunctionReference<
  "mutation",
  {
    deviceId: string;
    deviceSecret: string;
    batchId: string;
    clientCreatedAt: number;
    results: CloudResultInput[];
  },
  { batchId: string; idempotent: boolean; status: string }
>("cloudWorkspace:putBatch");
const createPhotoUploadUrl = makeFunctionReference<
  "action",
  { deviceId: string; deviceSecret: string; batchId: string; resultId: string },
  { url: string; method: string; expiresAt: number; headers: Record<string, string> }
>("cloudWorkspace:createPhotoUploadUrl");
const finalizeBatchUploads = makeFunctionReference<
  "action",
  { deviceId: string; deviceSecret: string; batchId: string },
  { idempotent: boolean }
>("cloudWorkspace:finalizeBatchUploads");
const putGuestCloudBatch = makeFunctionReference<
  "mutation",
  {
    guestCloudGrant: string;
    batchId: string;
    clientCreatedAt: number;
    results: CloudResultInput[];
  },
  { batchId: string; idempotent: boolean; status: string }
>("cloudWorkspace:putGuestBatch");
const createAppClipWorkspaceGrant = makeFunctionReference<
  "mutation", { clerkUserId: string; ownerName?: string },
  { guestCloudGrant: string; expiresAt: number }
>("cloudWorkspace:createAppClipWorkspaceGrantForHttp");
const createGuestPhotoUploadUrl = makeFunctionReference<
  "action",
  { guestCloudGrant: string; batchId: string; resultId: string },
  { url: string; method: string; expiresAt: number; headers: Record<string, string> }
>("cloudWorkspace:createGuestPhotoUploadUrl");
const finalizeGuestBatchUploads = makeFunctionReference<
  "action",
  { guestCloudGrant: string; batchId: string },
  { idempotent: boolean }
>("cloudWorkspace:finalizeGuestBatchUploads");
const createWorkspaceEnrollment = makeFunctionReference<
  "mutation",
  { kind: "ios" | "chrome"; label: string },
  { enrollmentCode: string; expiresAt: number }
>("cloudWorkspace:createEnrollment");
type WorkspaceSnapshot = {
  workspaceId: string;
  revision: number;
  batches: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    deliveryState: string;
    deliveries: Array<{ targetDeviceId: string; state: string; attempts: number }>;
    results: Array<{
      id: string;
      type: string;
      deliveryState: "available" | "deleted";
      value?: string;
      format?: string;
      photoObjectKey?: string;
      contentType?: string;
      byteCount: number;
      createdAt: string;
    }>;
  }>;
};
const getWorkspaceSnapshot = makeFunctionReference<"query", Record<string, never>, WorkspaceSnapshot>(
  "cloudWorkspace:workspaceSnapshot",
);
const createAuthenticatedPhotoDownloadUrl = makeFunctionReference<
  "action",
  { batchId: string; resultId: string },
  { url: string; method: string; expiresAt: number; headers: Record<string, string> }
>("cloudWorkspace:createPhotoDownloadUrl");
const registerWorkspaceComputer = makeFunctionReference<
  "mutation",
  { installationId: string; label: string; capabilities?: string[]; ttlMs?: number },
  { deviceId: string; workspaceId: string; registrationId: string; expiresAt: number }
>("cloudWorkspace:registerComputer");
const acknowledgeWorkspaceDelivery = makeFunctionReference<
  "mutation",
  {
    installationId: string;
    batchId: string;
    state: "delivered" | "failed";
    errorCode?: string;
  },
  { state: "delivered" | "failed" }
>("cloudWorkspace:acknowledgeDeliveryAsComputer");
const deleteWorkspaceResults = makeFunctionReference<
  "mutation",
  { resultIds: string[] },
  {
    deletedIds: string[];
    newlyDeletedIds: string[];
    deleted: number;
    idempotent: number;
    requested: number;
    revision: number;
  }
>("cloudWorkspace:deleteWorkspaceResults");
const restoreWorkspaceResults = makeFunctionReference<
  "mutation",
  { resultIds: string[] },
  {
    restoredIds: string[];
    newlyRestoredIds: string[];
    restored: number;
    idempotent: number;
    requested: number;
    revision: number;
  }
>("cloudWorkspace:restoreWorkspaceResults");

function anonymousCredentialsFromRequest(request: Request): Pick<AccessHttpArgs, "anonymousId" | "anonymousSecret"> {
  const anonymousId = request.headers.get("X-Volt-Anonymous-Id") ?? undefined;
  const anonymousSecret = request.headers.get("X-Volt-Anonymous-Secret") ?? undefined;
  return {
    ...(anonymousId ? { anonymousId } : {}),
    ...(anonymousSecret ? { anonymousSecret } : {}),
  };
}

async function accessArgsFromRequest(
  ctx: Pick<ActionCtx, "auth">,
  request: Request,
): Promise<{ ok: true; args: AccessHttpArgs } | { ok: false }> {
  const anonymousCredentials = anonymousCredentialsFromRequest(request);
  if (!request.headers.get("Authorization")) {
    return { ok: true, args: anonymousCredentials };
  }
  try {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false };
    return {
      ok: true,
      args: { ...clerkAuthContextFromIdentity(identity), ...anonymousCredentials },
    };
  } catch (_error) {
    return { ok: false };
  }
}

const anonymousTrialHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const access = await accessArgsFromRequest(ctx, request);
  if (!access.ok) return jsonResponse({ error: "Invalid Clerk authorization" }, 401);
  return runAndRespond(
    ctx.runMutation(anonymousTrialForHttp, access.args),
  );
});

const accessStatusHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const access = await accessArgsFromRequest(ctx, request);
  if (!access.ok) return jsonResponse({ error: "Invalid Clerk authorization" }, 401);
  return runAndRespond(
    ctx.runMutation(getStatusForHttp, access.args),
  );
});

function sessionStateHandler(end: boolean) {
  return httpAction(async (ctx, request) => {
    if (request.method === "OPTIONS") return emptyResponse();
    const body = await signalBodyFromRequest(request);
    const usageSessionId = stringFrom(body.usageSessionId, 120);
    if (!usageSessionId) return jsonResponse({ error: "Missing usageSessionId" }, 400);
    const access = await accessArgsFromRequest(ctx, request);
    if (!access.ok) return jsonResponse({ error: "Invalid Clerk authorization" }, 401);
    const args = {
      ...access.args,
      usageSessionId,
    };
    return runAndRespond(
      ctx.runMutation(end ? endSessionForHttp : disconnectSessionForHttp, args),
    );
  });
}

function cloudflareTurnTtlSecondsFromEnv() {
  const raw = process.env.CLOUDFLARE_TURN_TTL_SECONDS;
  if (!raw) return DEFAULT_CLOUDFLARE_TURN_TTL_SECONDS;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLOUDFLARE_TURN_TTL_SECONDS;
}

function scannerIceFallbackResponse(nowMs = Date.now()) {
  return scannerStunOnlyIceServersResponse({
    iceServers: SCANNER_STUN_ONLY_ICE_SERVERS,
    nowMs,
    ttlSeconds: STUN_FALLBACK_TTL_SECONDS,
  });
}

async function scannerIceServersResponse() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !apiToken) return scannerIceFallbackResponse();

  const ttlSeconds = cloudflareTurnTtlSecondsFromEnv();
  try {
    const response = await fetch(
      `${CLOUDFLARE_TURN_GENERATE_ICE_SERVERS_BASE_URL}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: ttlSeconds }),
      },
    );
    if (!response.ok) return scannerIceFallbackResponse();

    const body = (await response.json()) as { iceServers?: unknown };
    const iceServers = normalizeScannerIceServers(body.iceServers);
    if (!iceServers || iceServers.length === 0) return scannerIceFallbackResponse();

    return buildScannerIceServersResponse({
      iceServers,
      source: "cloudflare",
      ttlSeconds,
    });
  } catch (_error) {
    return scannerIceFallbackResponse();
  }
}

const signalHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();

  const url = new URL(request.url);
  const parts = signalPartsFromRequest(request);
  const body = await signalBodyFromRequest(request);

  const command = signalRouteCommand(request.method, parts);
  const startedAt = Date.now();
  const logContext = { command, parts, requestBody: body, startedAt };

  if (command === "getIceServers") {
    return jsonResponse(await scannerIceServersResponse());
  }

  if (command === "getPushPublicKey") {
    const publicKey = process.env.SCANNER_PUSH_VAPID_PUBLIC_KEY;
    if (!publicKey) return jsonResponse({ error: "Web Push is not configured" }, 404);
    return jsonResponse({ publicKey });
  }

  const reconnectBrowserSessionId = stringFrom(url.searchParams.get("sessionId"), 120);
  const rendezvousBody =
    command === "getPendingReconnectRequests"
      ? { browserSessionId: reconnectBrowserSessionId ?? "" }
      : body;
  const access = await accessArgsFromRequest(ctx, request);
  if (!access.ok) return jsonResponse({ error: "Invalid Clerk authorization" }, 401);
  return runAndRespond(
    executeScannerSignalRendezvous(ctx, {
      command,
      parts,
      body,
      origin: url.origin,
      startedAt,
      browserClaim: browserClaimFrom(request, body),
      pairingSecret: pairingSecretFrom(request, body),
      pendingReconnectBrowserSessionId: reconnectBrowserSessionId,
      auth: access.args,
      anonymousId: access.args.anonymousId,
      anonymousSecret: access.args.anonymousSecret,
    }),
    { ...logContext, requestBody: rendezvousBody },
  );
});

const storeKitTransactionHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const access = await accessArgsFromRequest(ctx, request);
  if (!access.ok || !access.args.clerkUserId) {
    return jsonResponse({ error: "Clerk authentication required" }, 401);
  }
  const body = await signalBodyFromRequest(request);
  const signedTransaction = stringFrom(body.signedTransaction, 100_000);
  if (!signedTransaction) return jsonResponse({ error: "Missing signedTransaction" }, 400);
  return runAndRespond(
    ctx.runAction(syncStoreKitForHttp, { ...access.args, signedTransaction }),
  );
});

const appClipGrantCreateHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const access = await accessArgsFromRequest(ctx, request);
  if (!access.ok || !access.args.clerkUserId) {
    return jsonResponse({ error: "Clerk authentication required" }, 401);
  }
  const body = await signalBodyFromRequest(request);
  const label = stringFrom(body.label, 120);
  const grant = await ctx.runMutation(createAppClipWorkspaceGrant, {
    clerkUserId: access.args.clerkUserId,
    ...(access.args.name ? { ownerName: access.args.name } : {}),
  });
  const url = new URL("https://volt.juanquenga.com/clip");
  url.searchParams.set("guestCloudGrant", grant.guestCloudGrant);
  url.searchParams.set("guestCloudExpiresAt", String(grant.expiresAt));
  url.searchParams.set("cloudUrl", new URL(request.url).origin);
  if (label) url.searchParams.set("label", label);
  return jsonResponse({ ...grant, qrCodeUrl: url.toString() });
});

const storeKitNotificationHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const signedPayload = stringFrom(body.signedPayload, 500_000);
  if (!signedPayload) return jsonResponse({ error: "Missing signedPayload" }, 400);
  return runAndRespond(ctx.runAction(acceptStoreKitNotification, { signedPayload }));
});

function numberField(value: unknown, key: string) {
  const field = objectFrom(value)[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function cloudResultFrom(value: unknown): CloudResultInput | null {
  const resultId = stringField(value, "resultId");
  const kind = stringField(value, "kind");
  const byteCount = numberField(value, "byteCount");
  const clientCreatedAt = numberField(value, "clientCreatedAt");
  if (
    !resultId ||
    (kind !== "text" && kind !== "barcode" && kind !== "photo" && kind !== "dictation") ||
    byteCount === undefined ||
    clientCreatedAt === undefined
  ) return null;
  const text = stringField(value, "text");
  const contentType = stringField(value, "contentType");
  const format = stringField(value, "format");
  const checksum = stringField(value, "checksum");
  return {
    resultId,
    kind,
    ...(text ? { text } : {}),
    ...(format ? { format } : {}),
    ...(contentType ? { contentType } : {}),
    byteCount,
    ...(checksum ? { checksum } : {}),
    clientCreatedAt,
  };
}

const mobileEnrollmentExchangeHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const enrollmentCode = stringFrom(body.enrollmentCode, 240);
  const label = stringFrom(body.label, 120);
  if (!enrollmentCode) return jsonResponse({ error: "Missing enrollmentCode" }, 400);
  return jsonResponse(await ctx.runMutation(exchangeWorkspaceEnrollment, {
    enrollmentCode,
    ...(label ? { label } : {}),
  }));
});

const mobileDeviceBootstrapHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  if (!(await ctx.auth.getUserIdentity())) return jsonResponse({ error: "Clerk authentication required" }, 401);
  const body = await signalBodyFromRequest(request);
  const installationId = stringFrom(body.installationId, 240);
  const label = stringFrom(body.label, 120);
  const existingDeviceId = stringFrom(body.existingDeviceId, 120);
  if (!installationId || !label) return jsonResponse({ error: "Missing installationId or label" }, 400);
  return jsonResponse(await ctx.runMutation(bootstrapMobileDevice, {
    installationId,
    label,
    ...(existingDeviceId ? { existingDeviceId } : {}),
  }));
});

const reserveAIScannerRequestRef = makeFunctionReference<
  "mutation",
  { deviceId: string; deviceSecret: string; requestId: string; mode: AIScannerMode },
  AIScannerReservation
>("aiScannerQuota:reserveAIScannerRequest");
const completeAIScannerRequestRef = makeFunctionReference<
  "mutation",
  { deviceId: string; deviceSecret: string; requestId: string; mode: AIScannerMode; value: string | null; format: string },
  { status: "succeeded"; quota: AIScannerReservation["quota"]; value: string | null; format: string }
>("aiScannerQuota:completeAIScannerRequest");
const refundAIScannerRequestRef = makeFunctionReference<
  "mutation",
  { deviceId: string; deviceSecret: string; requestId: string; errorCode: "upstream-failed" | "upstream-timeout" | "invalid-input" | "upstream-rate-limited" },
  { status: "refunded" | "succeeded"; quota: AIScannerReservation["quota"]; value?: string | null; format?: string }
>("aiScannerQuota:refundAIScannerRequest");
const findProductForAIScannerRef = makeFunctionReference<
  "query",
  ProductIdentity,
  AIScannerCatalogMatch | null
>("productData:findProductForAIScanner");

function logAIScannerEvent(
  requestId: string,
  mode: AIScannerMode,
  event: AIScannerTraceEvent | { stage: "request"; outcome: "started" | "completed" | "failed"; imageBytes?: number; valueFound?: boolean; errorCode?: string },
): void {
  console.info(`[AI_SCAN] ${JSON.stringify({ requestId, mode, ...event })}`);
}

const mobileAIScannerHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const modeValue = new URL(request.url).searchParams.get("mode");
  if (modeValue !== "upc" && modeValue !== "name") return jsonResponse({ error: "Invalid mode" }, 400);
  const mode = modeValue as AIScannerMode;
  const deviceId = request.headers.get("X-Volt-Device-Id")?.trim();
  const deviceSecret = request.headers.get("X-Volt-Device-Secret")?.trim();
  const requestId = request.headers.get("X-Volt-AI-Request-Id")?.trim();
  if (!deviceId || !deviceSecret) return jsonResponse({ error: "Missing device credentials" }, 401);
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return jsonResponse({ error: "AI request id must be a UUID", errorCode: "invalid-input" }, 400);
  }
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "image/jpeg") return jsonResponse({ error: "JPEG image required" }, 415);
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && Number.isFinite(Number(contentLength)) && Number(contentLength) > AI_SCANNER_MAX_IMAGE_BYTES) {
    return jsonResponse({ error: "Image is too large" }, 413);
  }
  const imageBytes = await request.arrayBuffer();
  if (imageBytes.byteLength === 0) return jsonResponse({ error: "Image body required" }, 400);
  if (imageBytes.byteLength > AI_SCANNER_MAX_IMAGE_BYTES) return jsonResponse({ error: "Image is too large" }, 413);
  const jpegHeader = new Uint8Array(imageBytes, 0, Math.min(imageBytes.byteLength, 3));
  if (jpegHeader.length < 3 || jpegHeader[0] !== 0xff || jpegHeader[1] !== 0xd8 || jpegHeader[2] !== 0xff) {
    return jsonResponse({ error: "Valid JPEG image required" }, 415);
  }
  const reservation = await ctx.runMutation(reserveAIScannerRequestRef, { deviceId, deviceSecret, requestId, mode });
  if (reservation.status === "succeeded") {
    return jsonResponse({ mode, value: reservation.value ?? null, format: reservation.format ?? (mode === "upc" ? "upc_a" : "item-name"), quota: reservation.quota });
  }
  if (reservation.status === "refunded") {
    return jsonResponse({ error: "AI request was already refunded", errorCode: reservation.errorCode ?? "upstream-failed", quota: reservation.quota }, 502);
  }
  if (reservation.status === "rejected") {
    if (reservation.errorCode === "invalid-device") return jsonResponse({ error: "Invalid or revoked device credential", errorCode: "invalid-device" }, 401);
    if (reservation.errorCode === "request-in-progress") return jsonResponse({ error: "AI request is already in progress", errorCode: "request-in-progress", quota: reservation.quota }, 409);
    const status = reservation.errorCode === "quota-exhausted" || reservation.errorCode === "rate-limited" ? 429 : 400;
    return jsonResponse({ error: reservation.errorCode ?? "AI request rejected", errorCode: reservation.errorCode, quota: reservation.quota }, status);
  }
  try {
    logAIScannerEvent(requestId, mode, { stage: "request", outcome: "started", imageBytes: imageBytes.byteLength });
    const analysis = await requestOpenRouterAnalysis(mode, imageBytes, {
      catalogLookup: async (identity) => await ctx.runQuery(findProductForAIScannerRef, identity),
      onTrace: (event) => logAIScannerEvent(requestId, mode, event),
    });
    const completed = await ctx.runMutation(completeAIScannerRequestRef, { deviceId, deviceSecret, requestId, mode, value: analysis.value, format: analysis.format });
    logAIScannerEvent(requestId, mode, { stage: "request", outcome: "completed", valueFound: completed.value !== null });
    return jsonResponse({ mode, value: completed.value, format: completed.format, quota: completed.quota });
  } catch (error) {
    const errorCode: "upstream-failed" | "upstream-timeout" | "upstream-rate-limited" = error instanceof AIScannerError && error.code === "upstream-timeout"
      ? "upstream-timeout" : error instanceof AIScannerError && error.code === "upstream-rate-limited" ? "upstream-rate-limited" : "upstream-failed";
    logAIScannerEvent(requestId, mode, { stage: "request", outcome: "failed", errorCode });
    try {
      const refunded = await ctx.runMutation(refundAIScannerRequestRef, { deviceId, deviceSecret, requestId, errorCode });
      if (refunded.status === "succeeded") {
        return jsonResponse({ mode, value: refunded.value ?? null, format: refunded.format ?? (mode === "upc" ? "upc_a" : "item-name"), quota: refunded.quota });
      }
      if (error instanceof AIScannerError) {
        const message = error.code === "not-configured" ? "AI scanner is not configured" : error.code === "upstream-timeout" ? "AI scanner timed out" : "AI scanner unavailable";
        return jsonResponse({ error: message, errorCode, quota: refunded.quota }, error.status);
      }
      return jsonResponse({ error: "AI scanner unavailable", errorCode, quota: refunded.quota }, 502);
    } catch {
      return jsonResponse({ error: "AI scanner unavailable", errorCode }, 502);
    }
  }
});

const mobileComputerListHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const deviceId = stringFrom(body.deviceId, 120);
  const deviceSecret = stringFrom(body.deviceSecret, 240);
  if (!deviceId || !deviceSecret) return jsonResponse({ error: "Missing device credentials" }, 400);
  return jsonResponse(await ctx.runQuery(listMobileComputers, { deviceId, deviceSecret }));
});

const mobileCursorTargetHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const deviceId = stringFrom(body.deviceId, 120);
  const deviceSecret = stringFrom(body.deviceSecret, 240);
  const rawCursorTargetDeviceId = objectFrom(body).cursorTargetDeviceId;
  if (
    !deviceId
    || !deviceSecret
    || (rawCursorTargetDeviceId !== null && typeof rawCursorTargetDeviceId !== "string")
  ) {
    return jsonResponse({ error: "Invalid device credentials or cursor target" }, 400);
  }
  return jsonResponse(await ctx.runMutation(setMobileCursorTarget, {
    deviceId,
    deviceSecret,
    cursorTargetDeviceId: rawCursorTargetDeviceId,
  }));
});

const mobileCursorDeliveryQueueHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const deviceId = stringFrom(body.deviceId, 120);
  const deviceSecret = stringFrom(body.deviceSecret, 240);
  const deliveryId = stringFrom(body.deliveryId, 240);
  const resultId = stringFrom(body.resultId, 240);
  const targetDeviceId = stringFrom(body.targetDeviceId, 240);
  const kind = stringFrom(body.kind, 20);
  const text = stringFrom(body.text, 100_000);
  const format = stringFrom(body.format, 120);
  const clientCreatedAt = numberField(body, "clientCreatedAt");
  if (
    !deviceId
    || !deviceSecret
    || !deliveryId
    || !resultId
    || !targetDeviceId
    || (kind !== "barcode" && kind !== "text")
    || text === undefined
    || clientCreatedAt === undefined
  ) {
    return jsonResponse({ error: "Invalid cursor delivery" }, 400);
  }
  return jsonResponse(await ctx.runMutation(queueMobileCursorDelivery, {
    deviceId,
    deviceSecret,
    deliveryId,
    resultId,
    targetDeviceId,
    kind,
    text,
    ...(format ? { format } : {}),
    clientCreatedAt,
  }));
});

const mobileCursorDeliveryStatusHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const deviceId = stringFrom(body.deviceId, 120);
  const deviceSecret = stringFrom(body.deviceSecret, 240);
  const rawDeliveryIds = objectFrom(body).deliveryIds;
  const deliveryIds = Array.isArray(rawDeliveryIds)
    ? rawDeliveryIds
      .filter((item): item is string => typeof item === "string" && item.length <= 160)
      .slice(0, 100)
    : [];
  if (!deviceId || !deviceSecret) return jsonResponse({ error: "Missing device credentials" }, 400);
  return jsonResponse(await ctx.runQuery(cursorDeliveryStatus, { deviceId, deviceSecret, deliveryIds }));
});

const workspaceEnrollmentHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  if (!(await ctx.auth.getUserIdentity())) return jsonResponse({ error: "Clerk authentication required" }, 401);
  const body = await signalBodyFromRequest(request);
  const kind = stringFrom(body.kind, 20);
  const label = stringFrom(body.label, 120);
  if ((kind !== "ios" && kind !== "chrome") || !label) {
    return jsonResponse({ error: "Invalid enrollment kind or label" }, 400);
  }
  const enrollment = await ctx.runMutation(createWorkspaceEnrollment, { kind, label });
  return jsonResponse({
    ...enrollment,
    enrollmentUrl: `volt://enroll?enrollmentToken=${encodeURIComponent(enrollment.enrollmentCode)}`,
  });
});

const workspaceSnapshotHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  if (!(await ctx.auth.getUserIdentity())) return jsonResponse({ error: "Clerk authentication required" }, 401);
  return jsonResponse(await ctx.runQuery(getWorkspaceSnapshot, {}));
});

const workspacePhotoDownloadHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  if (!(await ctx.auth.getUserIdentity())) return jsonResponse({ error: "Clerk authentication required" }, 401);
  const body = await signalBodyFromRequest(request);
  const batchId = stringFrom(body.batchId, 240);
  const resultId = stringFrom(body.resultId, 240);
  if (!batchId || !resultId) return jsonResponse({ error: "Missing batchId or resultId" }, 400);
  return jsonResponse(await ctx.runAction(createAuthenticatedPhotoDownloadUrl, { batchId, resultId }));
});

const workspaceComputerRegistrationHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  if (!(await ctx.auth.getUserIdentity())) return jsonResponse({ error: "Clerk authentication required" }, 401);
  const body = await signalBodyFromRequest(request);
  const installationId = stringFrom(body.installationId, 240);
  const label = stringFrom(body.label, 120);
  const ttlMs = numberField(body, "ttlMs");
  const rawCapabilities = objectFrom(body).capabilities;
  const capabilities = Array.isArray(rawCapabilities)
    ? rawCapabilities.filter((item): item is string => typeof item === "string").slice(0, 50)
    : undefined;
  if (!installationId || !label) return jsonResponse({ error: "Missing installationId or label" }, 400);
  return jsonResponse(await ctx.runMutation(registerWorkspaceComputer, {
    installationId,
    label,
    ...(capabilities ? { capabilities } : {}),
    ...(ttlMs !== undefined ? { ttlMs } : {}),
  }));
});

const workspaceDeliveryAcknowledgementHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  if (!(await ctx.auth.getUserIdentity())) return jsonResponse({ error: "Clerk authentication required" }, 401);
  const body = await signalBodyFromRequest(request);
  const installationId = stringFrom(body.installationId, 240);
  const batchId = stringFrom(body.batchId, 240);
  const state = stringFrom(body.state, 20);
  const errorCode = stringFrom(body.errorCode, 120);
  if (!installationId || !batchId || (state !== "delivered" && state !== "failed")) {
    return jsonResponse({ error: "Invalid delivery acknowledgement" }, 400);
  }
  return jsonResponse(await ctx.runMutation(acknowledgeWorkspaceDelivery, {
    installationId,
    batchId,
    state,
    ...(errorCode ? { errorCode } : {}),
  }));
});

const workspaceResultDeletionHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  if (!(await ctx.auth.getUserIdentity())) return jsonResponse({ error: "Clerk authentication required" }, 401);
  const body = await signalBodyFromRequest(request);
  const rawResultIds = objectFrom(body).resultIds;
  if (!Array.isArray(rawResultIds) || rawResultIds.some((item) => typeof item !== "string")) {
    return jsonResponse({ error: "resultIds must be an array of strings" }, 400);
  }
  return jsonResponse(await ctx.runMutation(deleteWorkspaceResults, {
    resultIds: rawResultIds.slice(0, 500),
  }));
});

const workspaceResultRestoreHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  if (!(await ctx.auth.getUserIdentity())) return jsonResponse({ error: "Clerk authentication required" }, 401);
  const body = await signalBodyFromRequest(request);
  const rawResultIds = objectFrom(body).resultIds;
  if (!Array.isArray(rawResultIds) || rawResultIds.some((item) => typeof item !== "string")) {
    return jsonResponse({ error: "resultIds must be an array of strings" }, 400);
  }
  return jsonResponse(await ctx.runMutation(restoreWorkspaceResults, {
    resultIds: rawResultIds.slice(0, 500),
  }));
});

const mobileOutboxSyncHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const deviceId = stringFrom(body.deviceId, 120);
  const deviceSecret = stringFrom(body.deviceSecret, 240);
  const batchId = stringFrom(body.batchId, 240);
  const clientCreatedAt = numberField(body, "clientCreatedAt");
  const rawResults = objectFrom(body).results;
  const results = Array.isArray(rawResults) ? rawResults.map(cloudResultFrom) : [];
  if (!deviceId || !deviceSecret || !batchId || clientCreatedAt === undefined || results.some((item) => !item)) {
    return jsonResponse({ error: "Invalid outbox batch" }, 400);
  }
  return jsonResponse(await ctx.runMutation(putCloudBatch, {
    deviceId,
    deviceSecret,
    batchId,
    clientCreatedAt,
    results: results.filter((item): item is CloudResultInput => item !== null),
  }));
});

const appClipGuestOutboxSyncHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const guestCloudGrant = stringFrom(body.guestCloudGrant, 240);
  const batchId = stringFrom(body.batchId, 240);
  const clientCreatedAt = numberField(body, "clientCreatedAt");
  const rawResults = objectFrom(body).results;
  const results = Array.isArray(rawResults) ? rawResults.map(cloudResultFrom) : [];
  if (!guestCloudGrant || !batchId || clientCreatedAt === undefined || results.some((item) => !item)) {
    return jsonResponse({ error: "Invalid App Clip guest batch" }, 400);
  }
  return jsonResponse(await ctx.runMutation(putGuestCloudBatch, {
    guestCloudGrant,
    batchId,
    clientCreatedAt,
    results: results.filter((item): item is CloudResultInput => item !== null),
  }));
});

const appClipComputerListHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const guestCloudGrant = stringFrom(body.guestCloudGrant, 240);
  if (!guestCloudGrant) return jsonResponse({ error: "Missing guest cloud grant" }, 400);
  return jsonResponse(await ctx.runQuery(listAppClipComputers, { guestCloudGrant }));
});

const appClipCursorDeliveryQueueHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const guestCloudGrant = stringFrom(body.guestCloudGrant, 240);
  const deliveryId = stringFrom(body.deliveryId, 240);
  const resultId = stringFrom(body.resultId, 240);
  const targetDeviceId = stringFrom(body.targetDeviceId, 240);
  const kind = stringFrom(body.kind, 20);
  const text = stringFrom(body.text, 100_000);
  const format = stringFrom(body.format, 120);
  const clientCreatedAt = numberField(body, "clientCreatedAt");
  if (!guestCloudGrant || !deliveryId || !resultId || !targetDeviceId
    || (kind !== "barcode" && kind !== "text")
    || text === undefined
    || clientCreatedAt === undefined
  ) {
    return jsonResponse({ error: "Invalid App Clip cursor delivery" }, 400);
  }
  return jsonResponse(await ctx.runMutation(queueAppClipCursorDelivery, {
    guestCloudGrant,
    deliveryId,
    resultId,
    targetDeviceId,
    kind,
    text,
    ...(format ? { format } : {}),
    clientCreatedAt,
  }));
});

function appClipGuestBatchActionHandler(kind: "upload" | "finalize") {
  return httpAction(async (ctx, request) => {
    if (request.method === "OPTIONS") return emptyResponse();
    const body = await signalBodyFromRequest(request);
    const guestCloudGrant = stringFrom(body.guestCloudGrant, 240);
    const batchId = stringFrom(body.batchId, 240);
    if (!guestCloudGrant || !batchId) {
      return jsonResponse({ error: "Missing guest cloud grant or batch id" }, 400);
    }
    if (kind === "finalize") {
      return jsonResponse(await ctx.runAction(finalizeGuestBatchUploads, { guestCloudGrant, batchId }));
    }
    const resultId = stringFrom(body.resultId, 240);
    if (!resultId) return jsonResponse({ error: "Missing resultId" }, 400);
    return jsonResponse(await ctx.runAction(createGuestPhotoUploadUrl, {
      guestCloudGrant,
      batchId,
      resultId,
    }));
  });
}

function mobileBatchActionHandler(kind: "upload" | "finalize") {
  return httpAction(async (ctx, request) => {
    if (request.method === "OPTIONS") return emptyResponse();
    const body = await signalBodyFromRequest(request);
    const deviceId = stringFrom(body.deviceId, 120);
    const deviceSecret = stringFrom(body.deviceSecret, 240);
    const batchId = stringFrom(body.batchId, 240);
    if (!deviceId || !deviceSecret || !batchId) return jsonResponse({ error: "Missing device credentials or batch id" }, 400);
    if (kind === "finalize") {
      return jsonResponse(await ctx.runAction(finalizeBatchUploads, { deviceId, deviceSecret, batchId }));
    }
    const resultId = stringFrom(body.resultId, 240);
    if (!resultId) return jsonResponse({ error: "Missing resultId" }, 400);
    return jsonResponse(await ctx.runAction(createPhotoUploadUrl, { deviceId, deviceSecret, batchId, resultId }));
  });
}

function productApiError(
  code: string,
  message: string,
  status: number,
  headers: Record<string, string> = {},
) {
  return jsonResponse({ error: { code, message } }, status, headers);
}

function productApiRateLimitHeaders(result: {
  limit: number;
  remaining: number;
  resetAt: number;
}): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

type ProductApiRequestAuthorization =
  | { kind: "authorized"; headers: Record<string, string> }
  | { kind: "rejected"; response: Response };

async function authorizeProductApiRequest(
  ctx: ActionCtx,
  request: Request,
): Promise<ProductApiRequestAuthorization> {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  const token = match?.[1];
  if (!token) {
    return {
      kind: "rejected",
      response: productApiError(
        "missing_authorization",
        "Use an Authorization header with a Bearer API key",
        401,
      ),
    };
  }
  if (!hasProductApiKeyFormat(token)) {
    return {
      kind: "rejected",
      response: productApiError("invalid_api_key", "The API key is invalid or revoked", 401),
    };
  }

  const result = await ctx.runMutation(authenticateProductApiKey, {
    keyHash: await sha256Hex(token),
    now: Date.now(),
  });
  switch (result.kind) {
    case "authorized":
      return { kind: "authorized", headers: productApiRateLimitHeaders(result) };
    case "invalid_key":
      return {
        kind: "rejected",
        response: productApiError("invalid_api_key", "The API key is invalid or revoked", 401),
      };
    case "rate_limited": {
      const headers = {
        ...productApiRateLimitHeaders(result),
        "Retry-After": String(result.retryAfterSeconds),
      };
      return {
        kind: "rejected",
        response: productApiError(
          "rate_limit_exceeded",
          "This API key has reached its 120 requests per minute limit",
          429,
          headers,
        ),
      };
    }
    default: {
      const exhaustive: never = result;
      throw new Error(`Unhandled product API authorization result: ${exhaustive}`);
    }
  }
}

function productApiLimitFrom(url: URL): number | null {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 25;
  if (!/^\d+$/.test(raw)) return null;
  const limit = Number(raw);
  return limit >= 1 && limit <= 100 ? limit : null;
}

const productApiCollectionHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const authorization = await authorizeProductApiRequest(ctx, request);
  if (authorization.kind === "rejected") return authorization.response;

  const url = new URL(request.url);
  const limit = productApiLimitFrom(url);
  const searchQuery = url.searchParams.get("q");
  const cursorParameter = url.searchParams.get("cursor");
  if (
    limit === null
    || (searchQuery !== null && searchQuery.length > 200)
    || cursorParameter === ""
    || (cursorParameter !== null && cursorParameter.length > 1_024)
  ) {
    return productApiError(
      "invalid_request",
      "limit must be an integer from 1 to 100, q must be at most 200 characters, and cursor must be 1 to 1024 characters",
      400,
      authorization.headers,
    );
  }

  let result: ProductSearchResult;
  try {
    result = await ctx.runQuery(searchProductsForApi, {
      ...(searchQuery !== null ? { searchQuery } : {}),
      paginationOpts: { numItems: limit, cursor: cursorParameter },
    });
  } catch (error) {
    if (cursorParameter === null) throw error;
    return productApiError(
      "invalid_cursor",
      "The pagination cursor is invalid or expired",
      400,
      authorization.headers,
    );
  }
  return jsonResponse({
    data: result.page,
    pagination: {
      nextCursor: result.isDone ? null : result.continueCursor,
    },
  }, 200, authorization.headers);
});

const productApiItemHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const authorization = await authorizeProductApiRequest(ctx, request);
  if (authorization.kind === "rejected") return authorization.response;

  const encodedUpc = new URL(request.url).pathname.slice("/v1/products/".length);
  let upc: string;
  try {
    upc = decodeURIComponent(encodedUpc);
  } catch {
    return productApiError("invalid_request", "The UPC path segment is invalid", 400, authorization.headers);
  }
  if (!upc || upc.includes("/") || upc.length > 32) {
    return productApiError("invalid_request", "Provide one UPC path segment", 400, authorization.headers);
  }

  const product = await ctx.runQuery(getProductByUpcForApi, { upc });
  if (!product) {
    return productApiError("product_not_found", "No product was found for this UPC", 404, authorization.headers);
  }
  return jsonResponse({ data: product }, 200, authorization.headers);
});

http.route({ path: "/api/access/anonymous", method: "POST", handler: anonymousTrialHandler });
http.route({ path: "/api/access/anonymous", method: "OPTIONS", handler: anonymousTrialHandler });
http.route({ path: "/api/access/status", method: "GET", handler: accessStatusHandler });
http.route({ path: "/api/access/status", method: "OPTIONS", handler: accessStatusHandler });
const disconnectSessionHandler = sessionStateHandler(false);
const endSessionHandler = sessionStateHandler(true);
http.route({ path: "/api/access/session/disconnect", method: "POST", handler: disconnectSessionHandler });
http.route({ path: "/api/access/session/disconnect", method: "OPTIONS", handler: disconnectSessionHandler });
http.route({ path: "/api/access/session/end", method: "POST", handler: endSessionHandler });
http.route({ path: "/api/access/session/end", method: "OPTIONS", handler: endSessionHandler });
http.route({ path: "/api/storekit/transactions", method: "POST", handler: storeKitTransactionHandler });
http.route({ path: "/api/storekit/transactions", method: "OPTIONS", handler: storeKitTransactionHandler });
http.route({ path: "/api/storekit/notifications", method: "POST", handler: storeKitNotificationHandler });
http.route({ path: "/api/storekit/notifications", method: "OPTIONS", handler: storeKitNotificationHandler });
const mobilePhotoUploadHandler = mobileBatchActionHandler("upload");
const mobileBatchFinalizeHandler = mobileBatchActionHandler("finalize");
const appClipGuestPhotoUploadHandler = appClipGuestBatchActionHandler("upload");
const appClipGuestBatchFinalizeHandler = appClipGuestBatchActionHandler("finalize");
http.route({ path: "/api/mobile/enrollment/exchange", method: "POST", handler: mobileEnrollmentExchangeHandler });
http.route({ path: "/api/mobile/enrollment/exchange", method: "OPTIONS", handler: mobileEnrollmentExchangeHandler });
http.route({ path: "/api/mobile/devices/bootstrap", method: "POST", handler: mobileDeviceBootstrapHandler });
http.route({ path: "/api/mobile/devices/bootstrap", method: "OPTIONS", handler: mobileDeviceBootstrapHandler });
http.route({ path: "/api/mobile/ai/analyze", method: "POST", handler: mobileAIScannerHandler });
http.route({ path: "/api/mobile/ai/analyze", method: "OPTIONS", handler: mobileAIScannerHandler });
http.route({ path: "/api/mobile/computers/list", method: "POST", handler: mobileComputerListHandler });
http.route({ path: "/api/mobile/computers/list", method: "OPTIONS", handler: mobileComputerListHandler });
http.route({ path: "/api/mobile/cursor-target", method: "POST", handler: mobileCursorTargetHandler });
http.route({ path: "/api/mobile/cursor-target", method: "OPTIONS", handler: mobileCursorTargetHandler });
http.route({ path: "/api/mobile/deliveries/queue", method: "POST", handler: mobileCursorDeliveryQueueHandler });
http.route({ path: "/api/mobile/deliveries/queue", method: "OPTIONS", handler: mobileCursorDeliveryQueueHandler });
http.route({ path: "/api/mobile/deliveries/status", method: "POST", handler: mobileCursorDeliveryStatusHandler });
http.route({ path: "/api/mobile/deliveries/status", method: "OPTIONS", handler: mobileCursorDeliveryStatusHandler });
http.route({ path: "/api/mobile/outbox/sync", method: "POST", handler: mobileOutboxSyncHandler });
http.route({ path: "/api/mobile/outbox/sync", method: "OPTIONS", handler: mobileOutboxSyncHandler });
http.route({ path: "/api/mobile/photos/upload-url", method: "POST", handler: mobilePhotoUploadHandler });
http.route({ path: "/api/mobile/photos/upload-url", method: "OPTIONS", handler: mobilePhotoUploadHandler });
http.route({ path: "/api/mobile/batches/finalize", method: "POST", handler: mobileBatchFinalizeHandler });
http.route({ path: "/api/mobile/batches/finalize", method: "OPTIONS", handler: mobileBatchFinalizeHandler });
http.route({ path: "/api/app-clip/outbox/sync", method: "POST", handler: appClipGuestOutboxSyncHandler });
http.route({ path: "/api/app-clip/outbox/sync", method: "OPTIONS", handler: appClipGuestOutboxSyncHandler });
http.route({ path: "/api/app-clip/grants/create", method: "POST", handler: appClipGrantCreateHandler });
http.route({ path: "/api/app-clip/grants/create", method: "OPTIONS", handler: appClipGrantCreateHandler });
http.route({ path: "/api/app-clip/computers/list", method: "POST", handler: appClipComputerListHandler });
http.route({ path: "/api/app-clip/computers/list", method: "OPTIONS", handler: appClipComputerListHandler });
http.route({ path: "/api/app-clip/deliveries/queue", method: "POST", handler: appClipCursorDeliveryQueueHandler });
http.route({ path: "/api/app-clip/deliveries/queue", method: "OPTIONS", handler: appClipCursorDeliveryQueueHandler });
http.route({ path: "/api/app-clip/photos/upload-url", method: "POST", handler: appClipGuestPhotoUploadHandler });
http.route({ path: "/api/app-clip/photos/upload-url", method: "OPTIONS", handler: appClipGuestPhotoUploadHandler });
http.route({ path: "/api/app-clip/batches/finalize", method: "POST", handler: appClipGuestBatchFinalizeHandler });
http.route({ path: "/api/app-clip/batches/finalize", method: "OPTIONS", handler: appClipGuestBatchFinalizeHandler });
http.route({ path: "/api/workspace/enrollment", method: "POST", handler: workspaceEnrollmentHandler });
http.route({ path: "/api/workspace/enrollment", method: "OPTIONS", handler: workspaceEnrollmentHandler });
http.route({ path: "/api/workspace/snapshot", method: "GET", handler: workspaceSnapshotHandler });
http.route({ path: "/api/workspace/snapshot", method: "OPTIONS", handler: workspaceSnapshotHandler });
http.route({ path: "/api/workspace/photos/download-url", method: "POST", handler: workspacePhotoDownloadHandler });
http.route({ path: "/api/workspace/photos/download-url", method: "OPTIONS", handler: workspacePhotoDownloadHandler });
http.route({ path: "/api/workspace/computers/register", method: "POST", handler: workspaceComputerRegistrationHandler });
http.route({ path: "/api/workspace/computers/register", method: "OPTIONS", handler: workspaceComputerRegistrationHandler });
http.route({ path: "/api/workspace/deliveries/ack", method: "POST", handler: workspaceDeliveryAcknowledgementHandler });
http.route({ path: "/api/workspace/deliveries/ack", method: "OPTIONS", handler: workspaceDeliveryAcknowledgementHandler });
http.route({ path: "/api/workspace/results/delete", method: "POST", handler: workspaceResultDeletionHandler });
http.route({ path: "/api/workspace/results/delete", method: "OPTIONS", handler: workspaceResultDeletionHandler });
http.route({ path: "/api/workspace/results/restore", method: "POST", handler: workspaceResultRestoreHandler });
http.route({ path: "/api/workspace/results/restore", method: "OPTIONS", handler: workspaceResultRestoreHandler });

http.route({ path: "/v1/products", method: "GET", handler: productApiCollectionHandler });
http.route({ path: "/v1/products", method: "OPTIONS", handler: productApiCollectionHandler });
http.route({ pathPrefix: "/v1/products/", method: "GET", handler: productApiItemHandler });
http.route({ pathPrefix: "/v1/products/", method: "OPTIONS", handler: productApiItemHandler });

http.route({ path: "/api/signal", method: "GET", handler: signalHandler });
http.route({ path: "/api/signal", method: "POST", handler: signalHandler });
http.route({ path: "/api/signal", method: "OPTIONS", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "GET", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "POST", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "OPTIONS", handler: signalHandler });

export default http;
