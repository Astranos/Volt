import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { vi } from "vitest";

export const modules = import.meta.glob("./**/*.ts");

export type DeviceCredential = { deviceId: string; deviceSecret: string };

export type GuestCredential = { guestCloudGrant: string };

export const ensureWorkspace = makeFunctionReference<"mutation", Record<string, never>, { _id: string }>(
  "cloudWorkspace:ensureWorkspace",
);

export const createEnrollment = makeFunctionReference<
  "mutation",
  { kind: "ios" | "chrome"; label: string },
  { enrollmentCode: string; expiresAt: number }
>("cloudWorkspace:createEnrollment");

export const getAccessStatus = makeFunctionReference<
  "mutation",
  { anonymousId?: string; anonymousSecret?: string },
  { statusCode: number; body: { access: string } }
>("access:getStatus");

export const exchangeEnrollment = makeFunctionReference<
  "mutation",
  { enrollmentCode: string; label?: string },
  DeviceCredential & { workspaceId: string }
>("cloudWorkspace:exchangeEnrollment");

export const revokeDevice = makeFunctionReference<"mutation", { deviceId: string }, { revoked: boolean }>(
  "cloudWorkspace:revokeDevice",
);

export const putBatch = makeFunctionReference<
  "mutation",
  DeviceCredential & {
    batchId: string;
    clientCreatedAt: number;
    results: Array<{
      resultId: string;
      kind: "text" | "barcode" | "photo" | "dictation";
      text?: string;
      format?: string;
      contentType?: string;
      byteCount: number;
      checksum?: string;
      clientCreatedAt: number;
    }>;
  },
  { batchId: string; idempotent: boolean; status: string }
>("cloudWorkspace:putBatch");

export const markBatchReady = makeFunctionReference<
  "mutation",
  DeviceCredential & { batchId: string },
  { idempotent: boolean }
>("cloudWorkspace:markBatchReady");

export const listBatches = makeFunctionReference<"query", Record<string, never>, Array<{ batchId: string }>>(
  "cloudWorkspace:listBatches",
);

export const authorizePhotoAccess = makeFunctionReference<
  "query",
  DeviceCredential & { batchId: string; resultId: string; operation: "put" | "get" },
  { objectKey: string; contentType?: string }
>("cloudWorkspace:authorizePhotoAccess");

export const createPhotoUploadUrl = makeFunctionReference<
  "action",
  DeviceCredential & { batchId: string; resultId: string },
  { url: string; method: string; expiresAt: number; headers: Record<string, string> }
>("cloudWorkspace:createPhotoUploadUrl");

export const createPhotoDownloadUrl = makeFunctionReference<
  "action",
  { deviceId?: string; deviceSecret?: string; batchId: string; resultId: string },
  { url: string; method: string; expiresAt: number; headers: Record<string, string> }
>("cloudWorkspace:createPhotoDownloadUrl");

export const registerComputer = makeFunctionReference<
  "mutation",
  { installationId: string; label: string; capabilities?: string[]; ttlMs?: number },
  { deviceId: string; workspaceId: string; registrationId: string; expiresAt: number }
>("cloudWorkspace:registerComputer");

export const bootstrapMobileDevice = makeFunctionReference<
  "mutation",
  { installationId: string; label: string; existingDeviceId?: string },
  DeviceCredential & { workspaceId: string; clerkUserId: string }
>("cloudWorkspace:bootstrapMobileDevice");

export const listComputersForDevice = makeFunctionReference<
  "query",
  DeviceCredential,
  {
    cursorTargetDeviceId: string | null;
    computers: Array<{ deviceId: string; label: string; capabilities: string[]; online: boolean }>;
  }
>("cloudWorkspace:listComputersForDevice");

export const sweepExpiredPresence = makeFunctionReference<"mutation", Record<string, never>, null>(
  "cloudWorkspace:sweepExpiredPresence",
);

export const sweepExpiredCursorDeliveries = makeFunctionReference<"mutation", Record<string, never>, null>(
  "cloudWorkspace:sweepExpiredCursorDeliveries",
);

export const setCursorTarget = makeFunctionReference<
  "mutation",
  DeviceCredential & { cursorTargetDeviceId: string | null },
  { cursorTargetDeviceId: string | null }
>("cloudWorkspace:setCursorTarget");

export type CursorDeliveryInput = DeviceCredential & {
  deliveryId: string;
  resultId: string;
  targetDeviceId: string;
  kind: "barcode" | "text";
  text: string;
  format?: string;
  clientCreatedAt: number;
};

export const queueCursorDelivery = makeFunctionReference<
  "mutation",
  CursorDeliveryInput,
  { deliveryId: string; idempotent: boolean; state: "pending" | "delivered" | "failed" }
>("cloudWorkspace:queueCursorDelivery");

export const pendingCursorDeliveries = makeFunctionReference<
  "query",
  { installationId: string },
  Array<{ deliveryId: string; state: "pending"; expiresAt: number }>
>("cloudWorkspace:pendingCursorDeliveries");

export const acknowledgeCursorDelivery = makeFunctionReference<
  "mutation",
  {
    installationId: string;
    deliveryId: string;
    state: "delivered" | "failed";
    errorCode?: string;
  },
  { state: "pending" | "delivered" | "failed"; idempotent: boolean; attempts: number }
>("cloudWorkspace:acknowledgeCursorDelivery");

export const cursorDeliveryStatus = makeFunctionReference<
  "query",
  DeviceCredential & { deliveryIds: string[] },
  {
    statuses: Array<{
      deliveryId: string;
      state: "pending" | "delivered" | "failed";
      errorCode?: string;
      deliveredAt?: number;
    }>;
  }
>("cloudWorkspace:cursorDeliveryStatus");

export const deleteWorkspaceResults = makeFunctionReference<
  "mutation",
  { resultIds: string[] },
  { deletedIds: string[]; newlyDeletedIds: string[]; deleted: number; idempotent: number }
>("cloudWorkspace:deleteWorkspaceResults");

export const restoreWorkspaceResults = makeFunctionReference<
  "mutation",
  { resultIds: string[] },
  { restoredIds: string[]; newlyRestoredIds: string[]; restored: number; idempotent: number }
>("cloudWorkspace:restoreWorkspaceResults");

export const workspaceSnapshot = makeFunctionReference<
  "query",
  Record<string, never>,
  { batches: Array<{ results: Array<{ id: string; deliveryState: "available" | "deleted" }> }> } | null
>("cloudWorkspace:workspaceSnapshot");

export const createGuestGrant = makeFunctionReference<
  "mutation",
  { clerkUserId: string; joinToken: string; usageSessionId: string },
  GuestCredential & { expiresAt: number }
>("cloudWorkspace:createGuestGrant");

export const createAppClipWorkspaceGrant = makeFunctionReference<
  "mutation",
  { clerkUserId: string; ownerName?: string },
  GuestCredential & { expiresAt: number }
>("cloudWorkspace:createAppClipWorkspaceGrantForHttp");

export const putGuestBatch = makeFunctionReference<
  "mutation",
  GuestCredential & {
    batchId: string;
    clientCreatedAt: number;
    results: Array<ReturnType<typeof result>>;
  },
  { batchId: string; idempotent: boolean; status: string }
>("cloudWorkspace:putGuestBatch");

export const markGuestBatchReady = makeFunctionReference<
  "mutation",
  GuestCredential & { batchId: string },
  { idempotent: boolean }
>("cloudWorkspace:markGuestBatchReady");

export const listComputersForGuest = makeFunctionReference<
  "query",
  GuestCredential,
  { computers: Array<{ deviceId: string; label: string; capabilities: string[]; online: boolean }> }
>("cloudWorkspace:listComputersForGuest");

export const queueGuestCursorDelivery = makeFunctionReference<
  "mutation",
  GuestCredential & Omit<CursorDeliveryInput, keyof DeviceCredential>,
  { deliveryId: string; idempotent: boolean; state: "pending" | "delivered" | "failed" }
>("cloudWorkspace:queueGuestCursorDelivery");

export const updateDictationDraft = makeFunctionReference<
  "mutation",
  DeviceCredential & { draftId: string; targetDeviceId: string; text: string },
  { draftId: string; updatedAt: number }
>("cloudWorkspace:updateDictationDraft");

export const clearDictationDraft = makeFunctionReference<
  "mutation",
  DeviceCredential & { draftId: string },
  { cleared: boolean }
>("cloudWorkspace:clearDictationDraft");

export const liveDictationDraftsForComputer = makeFunctionReference<
  "query",
  { installationId: string },
  Array<{ draftId: string; text: string; updatedAt: number }>
>("cloudWorkspace:liveDictationDraftsForComputer");

export const authorizeGuestPhotoAccess = makeFunctionReference<
  "query",
  GuestCredential & { batchId: string; resultId: string; operation: "put" | "get" },
  { objectKey: string; contentType?: string }
>("cloudWorkspace:authorizePhotoAccess");

export function restoreWorkspaceTestEnvironment() {
  vi.useRealTimers();
  vi.unstubAllEnvs();
}

export async function grantFullAppAccess(t: ReturnType<typeof convexTest>, userId: string) {
  await t.run((ctx) => ctx.db.insert("entitlements", {
    clerkUserId: userId,
    kind: "manual",
    sourceIdentifier: `test-complimentary:${userId}`,
    productId: "com.volt.mobile.pro.monthly",
    status: "active",
    validFrom: Date.now(),
    updatedAt: Date.now(),
  }));
}

export async function enroll(
  t: ReturnType<typeof convexTest>,
  userId: string,
  kind: "ios" | "chrome" = "ios",
) {
  const signedIn = t.withIdentity({ subject: userId, name: userId });
  await grantFullAppAccess(t, userId);
  const enrollment = await signedIn.mutation(createEnrollment, { kind, label: `${userId} device` });
  const exchanged = await t.mutation(exchangeEnrollment, {
    enrollmentCode: enrollment.enrollmentCode,
  });
  return {
    signedIn,
    credential: { deviceId: exchanged.deviceId, deviceSecret: exchanged.deviceSecret },
    workspaceId: exchanged.workspaceId,
    enrollment,
  };
}

export function result(resultId: string, kind: "text" | "photo" | "dictation" = "text") {
  return {
    resultId,
    kind,
    ...(kind === "photo" ? { contentType: "image/jpeg" } : { text: resultId }),
    byteCount: 10,
    clientCreatedAt: 1,
  };
}

export async function guestGrant(
  t: ReturnType<typeof convexTest>,
  clerkUserId: string,
  usageSessionId = `usage-${clerkUserId}`,
) {
  const joinToken = `join-token-${clerkUserId}-abcdefghijklmnopqrstuvwxyz`;
  const now = Date.now();
  await t.run((ctx) => ctx.db.insert("scannerJoinTokens", {
    token: joinToken,
    sessionId: `session-${clerkUserId}`,
    createdAt: now,
    expiresAt: now + 60_000,
    graceExpiresAt: now + 90_000,
    usageSessionId,
    clerkUserId,
  }));
  return t.mutation(createGuestGrant, { clerkUserId, joinToken, usageSessionId });
}

export async function startGuestUsageSession(
  t: ReturnType<typeof convexTest>,
  clerkUserId: string,
  usageSessionId = `usage-${clerkUserId}`,
) {
  const now = Date.now();
  await t.run((ctx) => ctx.db.insert("usageSessions", {
    usageSessionId,
    browserSessionId: `session-${clerkUserId}`,
    ownerType: "user",
    clerkUserId,
    accessSource: "subscription",
    startedAt: now,
    lastConnectedAt: now,
    consumedAt: now,
  }));
}
