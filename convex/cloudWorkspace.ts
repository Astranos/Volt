import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { MAX_SESSION_DURATION_MS, RECONNECT_WINDOW_MS } from "./access";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

export const FREE_CLOUD_RESULT_LIMIT = 100;
export const FREE_CLOUD_BYTE_LIMIT = 50 * 1024 * 1024;
export const ENROLLMENT_TTL_MS = 5 * 60 * 1000;
export const CURSOR_DELIVERY_TTL_MS = 120 * 1000;
export const PRESIGN_TTL_SECONDS = 5 * 60;

const CANONICAL_CAPABILITIES = new Set([
  "workspace-results",
  "cursor-insertion",
  "photo-download",
]);
const deviceKind = v.union(v.literal("ios"), v.literal("chrome"));
const credentialArgs = { deviceId: v.string(), deviceSecret: v.string() };
const guestCredentialArgs = { guestCloudGrant: v.string() };
const resultInput = v.object({
  resultId: v.string(),
  kind: v.union(v.literal("text"), v.literal("barcode"), v.literal("photo"), v.literal("dictation")),
  text: v.optional(v.string()),
  format: v.optional(v.string()),
  contentType: v.optional(v.string()),
  byteCount: v.number(),
  checksum: v.optional(v.string()),
  clientCreatedAt: v.number(),
});

type DatabaseReaderCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
type Principal = {
  workspace: Doc<"workspaces">;
  sourceDeviceId: string;
  device?: Doc<"workspaceDevices">;
  guestGrant?: Doc<"workspaceGuestGrants">;
};
type DeviceCredential = { deviceId: string; deviceSecret: string };
type GuestCredential = { guestCloudGrant: string };
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
type CloudBatchInput = {
  batchId: string;
  clientCreatedAt: number;
  results: CloudResultInput[];
};

function randomOpaqueSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Hex(value: string | Uint8Array) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeCapabilities(capabilities: string[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawCapability of capabilities) {
    const trimmed = rawCapability.trim();
    if (!trimmed) continue;
    const lowercase = trimmed.toLowerCase();
    const capability = CANONICAL_CAPABILITIES.has(lowercase) ? lowercase : trimmed;
    if (seen.has(capability)) continue;
    seen.add(capability);
    normalized.push(capability);
    if (normalized.length === 50) break;
  }
  return normalized;
}

async function workspaceForUser(ctx: DatabaseReaderCtx, clerkUserId: string) {
  return ctx.db
    .query("workspaces")
    .withIndex("by_ownerClerkUserId", (q) => q.eq("ownerClerkUserId", clerkUserId))
    .unique();
}

async function requireAuthenticatedWorkspace(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  const workspace = await workspaceForUser(ctx, identity.subject);
  if (!workspace) throw new ConvexError("Workspace has not been created");
  return workspace;
}

async function requireOrCreateAuthenticatedWorkspace(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  return requireOrCreateWorkspaceForClerkUser(ctx, identity.subject, identity.name);
}

async function requireOrCreateWorkspaceForClerkUser(
  ctx: MutationCtx,
  clerkUserId: string,
  ownerName?: string,
) {
  const existing = await workspaceForUser(ctx, clerkUserId);
  if (existing) return existing;
  const now = Date.now();
  const workspaceId = await ctx.db.insert("workspaces", {
    ownerClerkUserId: clerkUserId,
    name: ownerName ? `${ownerName}'s Volt workspace` : "My Volt workspace",
    createdAt: now,
    updatedAt: now,
  });
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) throw new ConvexError("Workspace creation failed");
  return workspace;
}

async function requireDevicePrincipal(
  ctx: DatabaseReaderCtx,
  args: { deviceId: string; deviceSecret: string },
): Promise<Principal> {
  const device = await ctx.db
    .query("workspaceDevices")
    .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
    .unique();
  if (!device || device.revokedAt || device.credentialHash !== (await sha256Hex(args.deviceSecret))) {
    throw new ConvexError("Invalid or revoked device credential");
  }
  const workspace = await ctx.db.get(device.workspaceId);
  if (!workspace) throw new ConvexError("Workspace no longer exists");
  return { workspace, sourceDeviceId: device.deviceId, device };
}

async function requireGuestPrincipal(
  ctx: DatabaseReaderCtx,
  args: GuestCredential,
): Promise<Principal> {
  const grantHash = await sha256Hex(args.guestCloudGrant);
  const grant = await ctx.db
    .query("workspaceGuestGrants")
    .withIndex("by_grantHash", (q) => q.eq("grantHash", grantHash))
    .unique();
  const now = Date.now();
  if (!grant || grant.revokedAt || grant.expiresAt <= now) {
    throw new ConvexError("Guest cloud grant is invalid or expired");
  }

  const usageSession = await ctx.db
    .query("usageSessions")
    .withIndex("by_usageSessionId", (q) => q.eq("usageSessionId", grant.usageSessionId))
    .unique();
  if (usageSession) {
    const reconnectExpired = usageSession.disconnectedAt !== undefined
      && usageSession.disconnectedAt + RECONNECT_WINDOW_MS <= now;
    if (
      usageSession.clerkUserId !== grant.createdByClerkUserId
      || usageSession.endedAt !== undefined
      || usageSession.startedAt + MAX_SESSION_DURATION_MS <= now
      || reconnectExpired
    ) {
      throw new ConvexError("Guest cloud session has ended");
    }
  } else {
    const joinToken = await ctx.db.get(grant.scannerJoinTokenId);
    if (
      !joinToken
      || joinToken.revokedAt !== undefined
      || joinToken.expiresAt <= now
      || joinToken.usageSessionId !== grant.usageSessionId
      || joinToken.clerkUserId !== grant.createdByClerkUserId
    ) {
      throw new ConvexError("Guest cloud session is not active");
    }
  }

  const workspace = await ctx.db.get(grant.workspaceId);
  if (!workspace || workspace.ownerClerkUserId !== grant.createdByClerkUserId) {
    throw new ConvexError("Guest cloud workspace no longer exists");
  }
  return { workspace, sourceDeviceId: grant.sourceDeviceId, guestGrant: grant };
}

async function hasCloudSubscription(ctx: DatabaseReaderCtx, clerkUserId: string, now: number) {
  const entitlements = await ctx.db
    .query("entitlements")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
    .take(100);
  return entitlements.some(
    (item) => item.status === "active" && (item.expiresAt === undefined || item.expiresAt > now),
  );
}

async function enforceQuota(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  addedResults: number,
  addedBytes: number,
) {
  if (addedResults < 0 || addedBytes < 0) throw new ConvexError("Invalid quota usage");
  if (await hasCloudSubscription(ctx, workspace.ownerClerkUserId, Date.now())) return;
  const batches = await ctx.db
    .query("resultBatches")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
    .take(FREE_CLOUD_RESULT_LIMIT + 1);
  const active = batches.filter((batch) => batch.status !== "deleted");
  const resultCount = active.reduce((sum, batch) => sum + batch.resultCount, 0);
  const byteCount = active.reduce((sum, batch) => sum + batch.byteCount, 0);
  if (resultCount + addedResults > FREE_CLOUD_RESULT_LIMIT || byteCount + addedBytes > FREE_CLOUD_BYTE_LIMIT) {
    throw new ConvexError("Free cloud allowance exceeded");
  }
}

export const ensureWorkspace = mutation({
  args: {},
  handler: async (ctx) => requireOrCreateAuthenticatedWorkspace(ctx),
});

export const createGuestGrant = internalMutation({
  args: {
    clerkUserId: v.string(),
    joinToken: v.string(),
    usageSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const scannerJoinToken = await ctx.db
      .query("scannerJoinTokens")
      .withIndex("by_token", (q) => q.eq("token", args.joinToken))
      .unique();
    const now = Date.now();
    if (
      !scannerJoinToken
      || scannerJoinToken.revokedAt !== undefined
      || scannerJoinToken.expiresAt <= now
      || scannerJoinToken.clerkUserId !== args.clerkUserId
      || scannerJoinToken.usageSessionId !== args.usageSessionId
    ) {
      throw new ConvexError("Cannot create a guest grant for an inactive scanner session");
    }

    const existing = await ctx.db
      .query("workspaceGuestGrants")
      .withIndex("by_usageSessionId", (q) => q.eq("usageSessionId", args.usageSessionId))
      .take(20);
    for (const grant of existing) {
      if (!grant.revokedAt) await ctx.db.patch(grant._id, { revokedAt: now });
    }

    const workspace = await requireOrCreateWorkspaceForClerkUser(ctx, args.clerkUserId);
    const guestCloudGrant = randomOpaqueSecret();
    const expiresAt = now + MAX_SESSION_DURATION_MS;
    await ctx.db.insert("workspaceGuestGrants", {
      workspaceId: workspace._id,
      scannerJoinTokenId: scannerJoinToken._id,
      usageSessionId: args.usageSessionId,
      createdByClerkUserId: args.clerkUserId,
      grantHash: await sha256Hex(guestCloudGrant),
      sourceDeviceId: `appclip:${crypto.randomUUID()}`,
      createdAt: now,
      expiresAt,
    });
    return { guestCloudGrant, expiresAt };
  },
});

export const createEnrollment = mutation({
  args: { kind: deviceKind, label: v.string() },
  handler: async (ctx, args) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const code = randomOpaqueSecret();
    const now = Date.now();
    await ctx.db.insert("workspaceEnrollments", {
      workspaceId: workspace._id,
      createdByClerkUserId: workspace.ownerClerkUserId,
      codeHash: await sha256Hex(code),
      deviceKind: args.kind,
      label: args.label,
      expiresAt: now + ENROLLMENT_TTL_MS,
      createdAt: now,
    });
    return { enrollmentCode: code, expiresAt: now + ENROLLMENT_TTL_MS };
  },
});

export const exchangeEnrollment = mutation({
  args: { enrollmentCode: v.string(), label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const codeHash = await sha256Hex(args.enrollmentCode);
    const enrollment = await ctx.db
      .query("workspaceEnrollments")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
      .unique();
    const now = Date.now();
    if (!enrollment || enrollment.consumedAt || enrollment.expiresAt <= now) {
      throw new ConvexError("Enrollment code is invalid, expired, or already used");
    }
    const deviceId = crypto.randomUUID();
    const deviceSecret = randomOpaqueSecret();
    await ctx.db.insert("workspaceDevices", {
      workspaceId: enrollment.workspaceId,
      deviceId,
      credentialHash: await sha256Hex(deviceSecret),
      kind: enrollment.deviceKind,
      label: args.label ?? enrollment.label,
      createdAt: now,
      lastSeenAt: now,
    });
    await ctx.db.patch(enrollment._id, { consumedAt: now });
    return { deviceId, deviceSecret, workspaceId: enrollment.workspaceId };
  },
});

export const bootstrapMobileDevice = mutation({
  args: {
    installationId: v.string(),
    label: v.string(),
    existingDeviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.installationId.trim() || !args.label.trim()) {
      throw new ConvexError("Installation id and label are required");
    }
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const now = Date.now();
    const existingDeviceId = args.existingDeviceId;
    if (existingDeviceId) {
      const existing = await ctx.db
        .query("workspaceDevices")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", existingDeviceId))
        .unique();
      if (existing && existing.workspaceId !== workspace._id) {
        throw new ConvexError("Existing device belongs to another workspace");
      }
      if (existing?.kind === "ios" && existing.revokedAt === undefined) {
        const deviceSecret = randomOpaqueSecret();
        await ctx.db.patch(existing._id, {
          credentialHash: await sha256Hex(deviceSecret),
          label: args.label,
          lastSeenAt: now,
        });
        return {
          deviceId: existing.deviceId,
          deviceSecret,
          workspaceId: workspace._id,
          clerkUserId: workspace.ownerClerkUserId,
        };
      }
    }

    const deviceId = crypto.randomUUID();
    const deviceSecret = randomOpaqueSecret();
    await ctx.db.insert("workspaceDevices", {
      workspaceId: workspace._id,
      deviceId,
      credentialHash: await sha256Hex(deviceSecret),
      kind: "ios",
      label: args.label,
      createdAt: now,
      lastSeenAt: now,
    });
    return {
      deviceId,
      deviceSecret,
      workspaceId: workspace._id,
      clerkUserId: workspace.ownerClerkUserId,
    };
  },
});

export const registerComputer = mutation({
  args: {
    installationId: v.string(),
    label: v.string(),
    capabilities: v.optional(v.array(v.string())),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.installationId))
      .unique();
    if (existing && existing.kind !== "chrome") {
      throw new ConvexError("Computer installation id is already registered");
    }
    let deviceId: Id<"workspaceDevices">;
    if (existing && existing.workspaceId !== workspace._id) {
      const staleDeliveries = await ctx.db
        .query("cursorDeliveries")
        .withIndex("by_targetDeviceId_and_state", (q) =>
          q.eq("targetDeviceId", args.installationId).eq("state", "pending"),
        )
        .collect();
      for (const delivery of staleDeliveries) {
        if (delivery.workspaceId === existing.workspaceId) {
          await ctx.db.patch(delivery._id, {
            state: "failed",
            errorCode: "target-rebound",
            updatedAt: now,
          });
        }
      }
      const stalePresence = await ctx.db
        .query("workspacePresence")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", args.installationId))
        .unique();
      if (stalePresence) await ctx.db.delete(stalePresence._id);
      await ctx.db.delete(existing._id);
      deviceId = await ctx.db.insert("workspaceDevices", {
        workspaceId: workspace._id,
        deviceId: args.installationId,
        credentialHash: await sha256Hex(randomOpaqueSecret()),
        kind: "chrome",
        label: args.label,
        createdAt: now,
        lastSeenAt: now,
      });
    } else if (existing) {
      await ctx.db.patch(existing._id, {
        label: args.label,
        lastSeenAt: now,
        revokedAt: undefined,
      });
      deviceId = existing._id;
    } else {
      deviceId = await ctx.db.insert("workspaceDevices", {
        workspaceId: workspace._id,
        deviceId: args.installationId,
        credentialHash: await sha256Hex(randomOpaqueSecret()),
        kind: "chrome",
        label: args.label,
        createdAt: now,
        lastSeenAt: now,
      });
    }
    const ttlMs = Math.max(10_000, Math.min(args.ttlMs ?? 60_000, 120_000));
    const presence = await ctx.db
      .query("workspacePresence")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.installationId))
      .unique();
    const lease = {
      workspaceId: workspace._id,
      deviceId: args.installationId,
      state: "online" as const,
      capabilities: normalizeCapabilities(args.capabilities ?? []),
      lastSeenAt: now,
      expiresAt: now + ttlMs,
    };
    if (presence) await ctx.db.patch(presence._id, lease);
    else await ctx.db.insert("workspacePresence", lease);
    return {
      deviceId: args.installationId,
      workspaceId: workspace._id,
      registrationId: deviceId,
      expiresAt: lease.expiresAt,
    };
  },
});

export const revokeDevice = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const device = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .unique();
    if (!device || device.workspaceId !== workspace._id) throw new ConvexError("Device not found");
    const now = Date.now();
    await ctx.db.patch(device._id, { revokedAt: now });
    const presence = await ctx.db
      .query("workspacePresence")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", device.deviceId))
      .unique();
    if (presence) await ctx.db.patch(presence._id, { state: "offline", expiresAt: now });
    return { revoked: true };
  },
});

export const updatePresence = mutation({
  args: { ...credentialArgs, capabilities: v.array(v.string()), ttlMs: v.number() },
  handler: async (ctx, args) => {
    const { workspace, device } = await requireDevicePrincipal(ctx, args);
    if (!device) throw new ConvexError("Device required");
    const now = Date.now();
    const ttlMs = Math.max(10_000, Math.min(args.ttlMs, 120_000));
    const existing = await ctx.db
      .query("workspacePresence")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", device.deviceId))
      .unique();
    const value = {
      workspaceId: workspace._id,
      deviceId: device.deviceId,
      state: "online" as const,
      capabilities: normalizeCapabilities(args.capabilities),
      lastSeenAt: now,
      expiresAt: now + ttlMs,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("workspacePresence", value);
    await ctx.db.patch(device._id, { lastSeenAt: now });
    return { expiresAt: now + ttlMs };
  },
});

// Convex subscriptions only re-fire on writes, so a client that dies silently
// (no revokeDevice call) would otherwise show as online forever since
// listComputersForDevice only evaluates expiresAt at read time. This sweep
// forces a write once a lease expires so subscribers observe the flip.
export const sweepExpiredPresence = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const presence = await ctx.db.query("workspacePresence").collect();
    for (const item of presence) {
      if (item.state === "online" && item.expiresAt <= now) {
        await ctx.db.patch(item._id, { state: "offline" });
      }
    }
  },
});

// cursorDeliveryStatus synthesizes a pending-and-past-expiresAt delivery as
// failed/expired without writing anything, so (like presence) a Convex
// subscriber never observes the flip until some other write touches the row.
// This sweep performs that write explicitly, using the state index so cost
// stays bounded by the pending set rather than the full (unbounded, never
// pruned) cursorDeliveries table.
export const sweepExpiredCursorDeliveries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("cursorDeliveries")
      .withIndex("by_state", (q) => q.eq("state", "pending"))
      .collect();
    for (const delivery of pending) {
      if (delivery.expiresAt <= now) {
        await ctx.db.patch(delivery._id, {
          state: "failed",
          errorCode: "expired",
          updatedAt: now,
        });
      }
    }
  },
});

export const listComputersForDevice = query({
  args: credentialArgs,
  handler: async (ctx, args) => {
    const { workspace, device } = await requireDevicePrincipal(ctx, args);
    if (!device) throw new ConvexError("Device required");
    const devices = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const presence = await ctx.db
      .query("workspacePresence")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const byDevice = new Map(presence.map((item) => [item.deviceId, item]));
    const now = Date.now();
    return {
      cursorTargetDeviceId: device.cursorTargetDeviceId ?? null,
      computers: devices.filter((item) => item.kind === "chrome" && !item.revokedAt).map((item) => {
        const current = byDevice.get(item.deviceId);
        return {
          deviceId: item.deviceId,
          label: item.label,
          capabilities: normalizeCapabilities(current?.capabilities ?? []),
          online: Boolean(current && current.state === "online" && current.expiresAt > now),
        };
      }),
    };
  },
});

export const setCursorTarget = mutation({
  args: { ...credentialArgs, cursorTargetDeviceId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const { workspace, device } = await requireDevicePrincipal(ctx, args);
    if (!device || device.kind !== "ios") throw new ConvexError("iOS device credential required");
    if (args.cursorTargetDeviceId === null) {
      await ctx.db.patch(device._id, { cursorTargetDeviceId: undefined });
      return { cursorTargetDeviceId: null };
    }

    const cursorTargetDeviceId = args.cursorTargetDeviceId;
    const target = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", cursorTargetDeviceId))
      .unique();
    if (!target || target.workspaceId !== workspace._id || target.revokedAt || target.kind !== "chrome") {
      throw new ConvexError("Target computer not found");
    }
    const presence = await ctx.db
      .query("workspacePresence")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", target.deviceId))
      .unique();
    if (!presence || !normalizeCapabilities(presence.capabilities).includes("cursor-insertion")) {
      throw new ConvexError("Target computer does not support cursor insertion");
    }
    await ctx.db.patch(device._id, { cursorTargetDeviceId: target.deviceId });
    return { cursorTargetDeviceId: target.deviceId };
  },
});

async function insertBatchResults(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  sourceDeviceId: string,
  batchId: string,
  results: CloudBatchInput["results"],
  now: number,
) {
  for (const result of results) {
    const objectKey = result.kind === "photo"
      ? `workspaces/${workspaceId}/batches/${encodeURIComponent(batchId)}/${encodeURIComponent(result.resultId)}`
      : undefined;
    await ctx.db.insert("scanResults", {
      workspaceId,
      batchId,
      resultId: result.resultId,
      sourceDeviceId,
      kind: result.kind,
      ...(result.text !== undefined ? { text: result.text } : {}),
      ...(result.format !== undefined ? { format: result.format } : {}),
      ...(objectKey ? { objectKey } : {}),
      ...(result.contentType ? { contentType: result.contentType } : {}),
      byteCount: result.byteCount,
      ...(result.checksum ? { checksum: result.checksum } : {}),
      clientCreatedAt: result.clientCreatedAt,
      createdAt: now,
    });
  }
}

async function assertResultsAreBatchCompatible(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  results: CloudBatchInput["results"],
) {
  const seen = new Set<string>();
  for (const result of results) {
    if (seen.has(result.resultId)) throw new ConvexError("Duplicate result id in batch");
    seen.add(result.resultId);
    const conflicting = await ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_resultId", (q) =>
        q.eq("workspaceId", workspaceId).eq("resultId", result.resultId),
      )
      .first();
    if (conflicting) throw new ConvexError("Result id already belongs to another batch");
  }
}

async function putBatchForPrincipal(
  ctx: MutationCtx,
  principal: Principal,
  args: CloudBatchInput,
) {
    const { workspace, sourceDeviceId } = principal;
    if (args.results.length === 0) throw new ConvexError("A batch must contain at least one result");
    if (args.results.length > 500) throw new ConvexError("A batch may contain at most 500 results");
    const existing = await ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .unique();
    if (existing) {
      if (existing.sourceDeviceId !== sourceDeviceId) {
        throw new ConvexError("Batch id belongs to another source");
      }
      if (existing.status === "deleted") {
        throw new ConvexError("Batch was deleted");
      }

      const existingResults = await ctx.db
        .query("scanResults")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
        )
        .take(500);
      const existingIds = new Set(existingResults.map((item) => item.resultId));
      const appendedResults = args.results.filter((result) => !existingIds.has(result.resultId));
      if (appendedResults.length === 0) {
        return { batchId: existing.batchId, idempotent: true, status: existing.status };
      }
      if (existingResults.length + appendedResults.length > 500) {
        throw new ConvexError("A batch may contain at most 500 results");
      }

      await assertResultsAreBatchCompatible(ctx, workspace._id, appendedResults);
      const addedBytes = appendedResults.reduce((sum, result) => sum + result.byteCount, 0);
      await enforceQuota(ctx, workspace, appendedResults.length, addedBytes);
      const now = Date.now();
      await insertBatchResults(
        ctx,
        workspace._id,
        sourceDeviceId,
        args.batchId,
        appendedResults,
        now,
      );
      await ctx.db.patch(existing._id, {
        status: "uploading",
        resultCount: existingResults.length + appendedResults.length,
        byteCount: existing.byteCount + addedBytes,
        updatedAt: now,
      });
      return { batchId: args.batchId, idempotent: false, status: "uploading" as const };
    }

    await assertResultsAreBatchCompatible(ctx, workspace._id, args.results);
    const byteCount = args.results.reduce((sum, result) => sum + result.byteCount, 0);
    await enforceQuota(ctx, workspace, args.results.length, byteCount);
    const now = Date.now();
    await ctx.db.insert("resultBatches", {
      workspaceId: workspace._id,
      batchId: args.batchId,
      sourceDeviceId,
      clientCreatedAt: args.clientCreatedAt,
      status: "uploading",
      resultCount: args.results.length,
      byteCount,
      createdAt: now,
      updatedAt: now,
    });
    await insertBatchResults(
      ctx,
      workspace._id,
      sourceDeviceId,
      args.batchId,
      args.results,
      now,
    );
    return { batchId: args.batchId, idempotent: false, status: "uploading" as const };
}

export const putBatch = mutation({
  args: {
    ...credentialArgs,
    batchId: v.string(),
    clientCreatedAt: v.number(),
    results: v.array(resultInput),
  },
  handler: async (ctx, args) => {
    const principal = await requireDevicePrincipal(ctx, args);
    return putBatchForPrincipal(ctx, principal, args);
  },
});

export const putGuestBatch = mutation({
  args: {
    ...guestCredentialArgs,
    batchId: v.string(),
    clientCreatedAt: v.number(),
    results: v.array(resultInput),
  },
  handler: async (ctx, args) => {
    const principal = await requireGuestPrincipal(ctx, args);
    if (principal.guestGrant) {
      await ctx.db.patch(principal.guestGrant._id, { lastUsedAt: Date.now() });
    }
    return putBatchForPrincipal(ctx, principal, args);
  },
});

async function markBatchReadyForPrincipal(
  ctx: MutationCtx,
  principal: Principal,
  batchId: string,
) {
  const batch = await ctx.db
    .query("resultBatches")
    .withIndex("by_workspaceId_and_batchId", (q) =>
      q.eq("workspaceId", principal.workspace._id).eq("batchId", batchId),
    )
    .unique();
  if (!batch || batch.sourceDeviceId !== principal.sourceDeviceId) {
    throw new ConvexError("Batch not found");
  }
  if (batch.status === "ready") return { idempotent: true };
  await ctx.db.patch(batch._id, { status: "ready", updatedAt: Date.now() });
  return { idempotent: false };
}

export const markBatchReady = internalMutation({
  args: { ...credentialArgs, batchId: v.string() },
  handler: async (ctx, args) => {
    return markBatchReadyForPrincipal(ctx, await requireDevicePrincipal(ctx, args), args.batchId);
  },
});

export const markGuestBatchReady = internalMutation({
  args: { ...guestCredentialArgs, batchId: v.string() },
  handler: async (ctx, args) => {
    return markBatchReadyForPrincipal(ctx, await requireGuestPrincipal(ctx, args), args.batchId);
  },
});

async function photoManifestForPrincipal(
  ctx: QueryCtx,
  principal: Principal,
  batchId: string,
) {
    const { workspace, sourceDeviceId } = principal;
    const batch = await ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", batchId),
      )
      .unique();
    if (!batch || batch.status !== "uploading" || batch.sourceDeviceId !== sourceDeviceId) {
      throw new ConvexError("Uploading batch not found");
    }
    const results = await ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", batchId),
      )
      .take(500);
    return results
      .filter((item) => item.kind === "photo" && item.objectKey)
      .map((item) => ({ objectKey: item.objectKey as string, byteCount: item.byteCount }));
}

export const photoManifestForFinalize = internalQuery({
  args: { ...credentialArgs, batchId: v.string() },
  handler: async (ctx, args) => {
    return photoManifestForPrincipal(ctx, await requireDevicePrincipal(ctx, args), args.batchId);
  },
});

export const guestPhotoManifestForFinalize = internalQuery({
  args: { ...guestCredentialArgs, batchId: v.string() },
  handler: async (ctx, args) => {
    return photoManifestForPrincipal(ctx, await requireGuestPrincipal(ctx, args), args.batchId);
  },
});

const photoManifestForFinalizeRef = makeFunctionReference<
  "query",
  DeviceCredential & { batchId: string },
  Array<{ objectKey: string; byteCount: number }>
>("cloudWorkspace:photoManifestForFinalize");
const markBatchReadyRef = makeFunctionReference<
  "mutation",
  DeviceCredential & { batchId: string },
  { idempotent: boolean }
>("cloudWorkspace:markBatchReady");
const guestPhotoManifestForFinalizeRef = makeFunctionReference<
  "query",
  GuestCredential & { batchId: string },
  Array<{ objectKey: string; byteCount: number }>
>("cloudWorkspace:guestPhotoManifestForFinalize");
const markGuestBatchReadyRef = makeFunctionReference<
  "mutation",
  GuestCredential & { batchId: string },
  { idempotent: boolean }
>("cloudWorkspace:markGuestBatchReady");

async function verifyUploadedPhotos(photos: Array<{ objectKey: string; byteCount: number }>) {
  for (const photo of photos) {
    const presigned = await presignR2("HEAD", photo.objectKey);
    const response = await fetch(presigned.url, { method: "HEAD" });
    const length = Number(response.headers.get("content-length"));
    if (!response.ok || !Number.isFinite(length) || length !== photo.byteCount) {
      throw new ConvexError("R2 photo verification failed");
    }
  }
}

export const finalizeBatchUploads = action({
  args: { ...credentialArgs, batchId: v.string() },
  handler: async (ctx, args) => {
    const photos = await ctx.runQuery(photoManifestForFinalizeRef, args);
    await verifyUploadedPhotos(photos);
    return ctx.runMutation(markBatchReadyRef, args);
  },
});

export const finalizeGuestBatchUploads = action({
  args: { ...guestCredentialArgs, batchId: v.string() },
  handler: async (ctx, args) => {
    const photos = await ctx.runQuery(guestPhotoManifestForFinalizeRef, args);
    await verifyUploadedPhotos(photos);
    return ctx.runMutation(markGuestBatchReadyRef, args);
  },
});

export const queueDelivery = mutation({
  args: { ...credentialArgs, batchId: v.string(), targetDeviceId: v.string() },
  handler: async (ctx, args) => {
    const { workspace } = await requireDevicePrincipal(ctx, args);
    const batch = await ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .unique();
    const target = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.targetDeviceId))
      .unique();
    if (!batch || batch.status !== "ready") throw new ConvexError("Ready batch not found");
    if (!target || target.workspaceId !== workspace._id || target.revokedAt || target.kind !== "chrome") {
      throw new ConvexError("Target computer not found");
    }
    const existing = (await ctx.db
      .query("resultDeliveries")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .collect()).find((item) => item.targetDeviceId === target.deviceId);
    if (existing) return { deliveryId: existing._id, idempotent: true };
    const deliveryId = await ctx.db.insert("resultDeliveries", {
      workspaceId: workspace._id,
      batchId: args.batchId,
      targetDeviceId: target.deviceId,
      state: "pending",
      attempts: 0,
      updatedAt: Date.now(),
    });
    return { deliveryId, idempotent: false };
  },
});

export const acknowledgeDelivery = mutation({
  args: {
    ...credentialArgs,
    batchId: v.string(),
    state: v.union(v.literal("delivered"), v.literal("failed")),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace, device } = await requireDevicePrincipal(ctx, args);
    if (!device || device.kind !== "chrome") throw new ConvexError("Computer credential required");
    const delivery = (await ctx.db
      .query("resultDeliveries")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .collect()).find((item) => item.targetDeviceId === device.deviceId);
    if (!delivery) throw new ConvexError("Delivery not found");
    const now = Date.now();
    await ctx.db.patch(delivery._id, {
      state: args.state,
      attempts: delivery.attempts + 1,
      lastAttemptAt: now,
      ...(args.state === "delivered" ? { deliveredAt: now, errorCode: undefined } : { errorCode: args.errorCode }),
      updatedAt: now,
    });
    return { state: args.state };
  },
});

export const acknowledgeDeliveryAsComputer = mutation({
  args: {
    installationId: v.string(),
    batchId: v.string(),
    state: v.union(v.literal("delivered"), v.literal("failed")),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const computer = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.installationId))
      .unique();
    if (!computer || computer.workspaceId !== workspace._id || computer.kind !== "chrome" || computer.revokedAt) {
      throw new ConvexError("Registered computer not found");
    }
    const delivery = (await ctx.db
      .query("resultDeliveries")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .collect()).find((item) => item.targetDeviceId === computer.deviceId);
    if (!delivery) throw new ConvexError("Delivery not found");
    const now = Date.now();
    await ctx.db.patch(delivery._id, {
      state: args.state,
      attempts: delivery.attempts + 1,
      lastAttemptAt: now,
      ...(args.state === "delivered" ? { deliveredAt: now, errorCode: undefined } : { errorCode: args.errorCode }),
      updatedAt: now,
    });
    return { state: args.state };
  },
});

export const queueCursorDelivery = mutation({
  args: {
    ...credentialArgs,
    deliveryId: v.string(),
    resultId: v.string(),
    targetDeviceId: v.string(),
    kind: v.union(v.literal("barcode"), v.literal("text")),
    text: v.string(),
    format: v.optional(v.string()),
    clientCreatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { workspace, device } = await requireDevicePrincipal(ctx, args);
    if (!device) throw new ConvexError("Device required");
    const existing = await ctx.db
      .query("cursorDeliveries")
      .withIndex("by_workspaceId_and_deliveryId", (q) =>
        q.eq("workspaceId", workspace._id).eq("deliveryId", args.deliveryId),
      )
      .unique();
    if (existing) {
      if (
        existing.sourceDeviceId !== device.deviceId
        || existing.resultId !== args.resultId
        || existing.targetDeviceId !== args.targetDeviceId
        || existing.kind !== args.kind
        || existing.text !== args.text
        || existing.format !== args.format
        || existing.clientCreatedAt !== args.clientCreatedAt
      ) {
        throw new ConvexError("Delivery id conflicts with an existing delivery");
      }
      return { deliveryId: existing.deliveryId, idempotent: true, state: existing.state };
    }

    const result = await ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_resultId", (q) =>
        q.eq("workspaceId", workspace._id).eq("resultId", args.resultId),
      )
      .unique();
    if (
      !result
      || result.sourceDeviceId !== device.deviceId
      || result.deletedAt !== undefined
      || (result.kind !== "barcode" && result.kind !== "text")
    ) {
      throw new ConvexError("Deliverable result not found");
    }
    if (result.kind !== args.kind || result.text !== args.text || result.format !== args.format) {
      throw new ConvexError("Delivery payload does not match the stored result");
    }

    const target = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.targetDeviceId))
      .unique();
    if (!target || target.workspaceId !== workspace._id || target.revokedAt || target.kind !== "chrome") {
      throw new ConvexError("Target computer not found");
    }

    const now = Date.now();
    await ctx.db.insert("cursorDeliveries", {
      workspaceId: workspace._id,
      deliveryId: args.deliveryId,
      resultId: args.resultId,
      sourceDeviceId: device.deviceId,
      targetDeviceId: target.deviceId,
      kind: args.kind,
      text: args.text,
      ...(args.format !== undefined ? { format: args.format } : {}),
      state: "pending",
      attempts: 0,
      clientCreatedAt: args.clientCreatedAt,
      expiresAt: Math.min(
        args.clientCreatedAt + CURSOR_DELIVERY_TTL_MS,
        now + CURSOR_DELIVERY_TTL_MS,
      ),
      createdAt: now,
      updatedAt: now,
    });
    return { deliveryId: args.deliveryId, idempotent: false, state: "pending" as const };
  },
});

export const pendingCursorDeliveries = query({
  args: { installationId: v.string() },
  handler: async (ctx, args) => {
    const workspace = await requireAuthenticatedWorkspace(ctx);
    const computer = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.installationId))
      .unique();
    if (!computer || computer.workspaceId !== workspace._id || computer.kind !== "chrome" || computer.revokedAt) {
      return [];
    }
    const deliveries = await ctx.db
      .query("cursorDeliveries")
      .withIndex("by_targetDeviceId_and_state", (q) =>
        q.eq("targetDeviceId", computer.deviceId).eq("state", "pending"),
      )
      .collect();
    return deliveries.filter((delivery) =>
      delivery.workspaceId === workspace._id
    ).map((delivery) => ({
      deliveryId: delivery.deliveryId,
      resultId: delivery.resultId,
      sourceDeviceId: delivery.sourceDeviceId,
      targetDeviceId: delivery.targetDeviceId,
      kind: delivery.kind,
      text: delivery.text,
      ...(delivery.format !== undefined ? { format: delivery.format } : {}),
      state: delivery.state,
      attempts: delivery.attempts,
      clientCreatedAt: delivery.clientCreatedAt,
      expiresAt: delivery.expiresAt,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
    }));
  },
});

export const acknowledgeCursorDelivery = mutation({
  args: {
    installationId: v.string(),
    deliveryId: v.string(),
    state: v.union(v.literal("delivered"), v.literal("failed")),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const computer = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.installationId))
      .unique();
    if (!computer || computer.workspaceId !== workspace._id || computer.kind !== "chrome" || computer.revokedAt) {
      throw new ConvexError("Registered computer not found");
    }
    const delivery = await ctx.db
      .query("cursorDeliveries")
      .withIndex("by_workspaceId_and_deliveryId", (q) =>
        q.eq("workspaceId", workspace._id).eq("deliveryId", args.deliveryId),
      )
      .unique();
    if (!delivery || delivery.targetDeviceId !== computer.deviceId) {
      throw new ConvexError("Cursor delivery not found");
    }
    if (delivery.state !== "pending") {
      return { state: delivery.state, idempotent: true, attempts: delivery.attempts };
    }

    const now = Date.now();
    const attempts = delivery.attempts + 1;
    // A delivered acknowledgement that arrives after expiry is recorded as
    // failed/expired so a soft-expired status report can never later flip to
    // delivered (the phone already showed "failed").
    const expired = args.state === "delivered" && delivery.expiresAt <= now;
    const effectiveState = expired ? "failed" : args.state;
    await ctx.db.patch(delivery._id, {
      state: effectiveState,
      attempts,
      ...(effectiveState === "delivered"
        ? { deliveredAt: now, errorCode: undefined }
        : { errorCode: expired ? "expired" : args.errorCode }),
      updatedAt: now,
    });
    return { state: effectiveState, idempotent: false, attempts };
  },
});

const CURSOR_DELIVERY_STATUS_LIMIT = 100;

export const cursorDeliveryStatus = query({
  args: { ...credentialArgs, deliveryIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { workspace, device } = await requireDevicePrincipal(ctx, args);
    if (!device) throw new ConvexError("Device required");
    const deliveryIds = [...new Set(args.deliveryIds)].slice(0, CURSOR_DELIVERY_STATUS_LIMIT);
    const now = Date.now();
    const statuses: Array<{
      deliveryId: string;
      state: "pending" | "delivered" | "failed";
      errorCode?: string;
      deliveredAt?: number;
    }> = [];
    for (const deliveryId of deliveryIds) {
      const delivery = await ctx.db
        .query("cursorDeliveries")
        .withIndex("by_workspaceId_and_deliveryId", (q) =>
          q.eq("workspaceId", workspace._id).eq("deliveryId", deliveryId),
        )
        .unique();
      if (!delivery || delivery.sourceDeviceId !== device.deviceId) continue;
      if (delivery.state === "pending" && delivery.expiresAt <= now) {
        statuses.push({ deliveryId, state: "failed", errorCode: "expired" });
        continue;
      }
      statuses.push({
        deliveryId,
        state: delivery.state,
        ...(delivery.errorCode !== undefined ? { errorCode: delivery.errorCode } : {}),
        ...(delivery.deliveredAt !== undefined ? { deliveredAt: delivery.deliveredAt } : {}),
      });
    }
    return { statuses };
  },
});

export const listBatches = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await requireAuthenticatedWorkspace(ctx);
    return ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(100);
  },
});

export const listBatchResults = query({
  args: { batchId: v.string() },
  handler: async (ctx, args) => {
    const workspace = await requireAuthenticatedWorkspace(ctx);
    return ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .collect();
  },
});

export const deleteWorkspaceResults = mutation({
  args: { resultIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const requestedIds = [...new Set(args.resultIds)].slice(0, 500);
    const now = Date.now();
    const affectedBatches = new Map<string, { resultCount: number; byteCount: number }>();
    const deletedIds: string[] = [];
    const newlyDeletedIds: string[] = [];
    let deleted = 0;
    let idempotent = 0;
    for (const resultId of requestedIds) {
      const result = await ctx.db
        .query("scanResults")
        .withIndex("by_workspaceId_and_resultId", (q) =>
          q.eq("workspaceId", workspace._id).eq("resultId", resultId),
        )
        .first();
      if (!result) continue;
      deletedIds.push(resultId);
      if (result.deletedAt !== undefined) {
        idempotent += 1;
        continue;
      }
      await ctx.db.patch(result._id, { deletedAt: now });
      newlyDeletedIds.push(resultId);
      deleted += 1;
      const adjustment = affectedBatches.get(result.batchId) ?? { resultCount: 0, byteCount: 0 };
      adjustment.resultCount += 1;
      adjustment.byteCount += result.byteCount;
      affectedBatches.set(result.batchId, adjustment);
    }
    for (const [batchId, adjustment] of affectedBatches) {
      const batch = await ctx.db
        .query("resultBatches")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", batchId),
        )
        .unique();
      if (!batch) continue;
      await ctx.db.patch(batch._id, {
        resultCount: Math.max(0, batch.resultCount - adjustment.resultCount),
        byteCount: Math.max(0, batch.byteCount - adjustment.byteCount),
        updatedAt: now,
      });
    }
    return {
      deletedIds,
      newlyDeletedIds,
      deleted,
      idempotent,
      requested: requestedIds.length,
      revision: now,
    };
  },
});

export const restoreWorkspaceResults = mutation({
  args: { resultIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const requestedIds = [...new Set(args.resultIds)].slice(0, 500);
    const matches: Array<Doc<"scanResults">> = [];
    const restoredIds: string[] = [];
    const newlyRestoredIds: string[] = [];
    for (const resultId of requestedIds) {
      const result = await ctx.db
        .query("scanResults")
        .withIndex("by_workspaceId_and_resultId", (q) =>
          q.eq("workspaceId", workspace._id).eq("resultId", resultId),
        )
        .first();
      if (!result) continue;
      restoredIds.push(resultId);
      if (result.deletedAt !== undefined) matches.push(result);
    }
    const addedBytes = matches.reduce((sum, result) => sum + result.byteCount, 0);
    await enforceQuota(ctx, workspace, matches.length, addedBytes);

    const now = Date.now();
    const affectedBatches = new Map<string, { resultCount: number; byteCount: number }>();
    for (const result of matches) {
      await ctx.db.patch(result._id, { deletedAt: undefined });
      newlyRestoredIds.push(result.resultId);
      const adjustment = affectedBatches.get(result.batchId) ?? { resultCount: 0, byteCount: 0 };
      adjustment.resultCount += 1;
      adjustment.byteCount += result.byteCount;
      affectedBatches.set(result.batchId, adjustment);
    }
    for (const [batchId, adjustment] of affectedBatches) {
      const batch = await ctx.db
        .query("resultBatches")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", batchId),
        )
        .unique();
      if (!batch) continue;
      await ctx.db.patch(batch._id, {
        resultCount: batch.resultCount + adjustment.resultCount,
        byteCount: batch.byteCount + adjustment.byteCount,
        updatedAt: now,
      });
    }
    return {
      restoredIds,
      newlyRestoredIds,
      restored: newlyRestoredIds.length,
      idempotent: restoredIds.length - newlyRestoredIds.length,
      requested: requestedIds.length,
      revision: now,
    };
  },
});

export const workspaceSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await requireAuthenticatedWorkspace(ctx);
    const batches = await ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(100);
    const deliveries = await Promise.all(batches.map((batch) =>
      ctx.db
        .query("resultDeliveries")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", batch.batchId),
        )
        .collect(),
    ));
    const results = await Promise.all(batches.map((batch) =>
      ctx.db
        .query("scanResults")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", batch.batchId),
        )
        .collect(),
    ));
    const revision = batches.reduce(
      (latest, batch) => Math.max(latest, batch.updatedAt),
      workspace.updatedAt,
    );
    return {
      workspaceId: workspace._id,
      revision,
      batches: batches.map((batch, index) => ({
        id: batch.batchId,
        createdAt: new Date(batch.clientCreatedAt).toISOString(),
        updatedAt: new Date(batch.updatedAt).toISOString(),
        deliveryState: batch.status === "ready" ? "available" as const : batch.status,
        deliveries: deliveries[index].map((delivery) => ({
          targetDeviceId: delivery.targetDeviceId,
          state: delivery.state,
          attempts: delivery.attempts,
        })),
        results: results[index].map((result) => ({
          id: result.resultId,
          type: result.kind,
          deliveryState: result.deletedAt === undefined ? "available" as const : "deleted" as const,
          ...(result.text !== undefined ? { value: result.text } : {}),
          ...(result.format !== undefined ? { format: result.format } : {}),
          ...(result.objectKey !== undefined ? { photoObjectKey: result.objectKey } : {}),
          ...(result.contentType !== undefined ? { contentType: result.contentType } : {}),
          byteCount: result.byteCount,
          createdAt: new Date(result.clientCreatedAt).toISOString(),
        })),
      })),
    };
  },
});

export const listComputers = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await requireAuthenticatedWorkspace(ctx);
    const devices = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const presence = await ctx.db
      .query("workspacePresence")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const byDevice = new Map(presence.map((item) => [item.deviceId, item]));
    const now = Date.now();
    return devices.filter((item) => item.kind === "chrome" && !item.revokedAt).map((item) => {
      const current = byDevice.get(item.deviceId);
      return {
        deviceId: item.deviceId,
        label: item.label,
        online: Boolean(current && current.state === "online" && current.expiresAt > now),
        capabilities: current?.capabilities ?? [],
        lastSeenAt: current?.lastSeenAt ?? item.lastSeenAt,
      };
    });
  },
});

type PresignAuthorization = {
  objectKey: string;
  contentType?: string;
  checksum?: string;
};

export const authorizePhotoAccess = internalQuery({
  args: {
    deviceId: v.optional(v.string()),
    deviceSecret: v.optional(v.string()),
    guestCloudGrant: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
    batchId: v.string(),
    resultId: v.string(),
    operation: v.union(v.literal("put"), v.literal("get")),
  },
  handler: async (ctx, args): Promise<PresignAuthorization> => {
    let workspace: Doc<"workspaces"> | null = null;
    let sourceDeviceId: string | undefined;
    if (args.clerkUserId) workspace = await workspaceForUser(ctx, args.clerkUserId);
    else if (args.guestCloudGrant) {
      const principal = await requireGuestPrincipal(ctx, { guestCloudGrant: args.guestCloudGrant });
      workspace = principal.workspace;
      sourceDeviceId = principal.sourceDeviceId;
    }
    else if (args.deviceId && args.deviceSecret) {
      const principal = await requireDevicePrincipal(ctx, {
        deviceId: args.deviceId,
        deviceSecret: args.deviceSecret,
      });
      workspace = principal.workspace;
      sourceDeviceId = principal.sourceDeviceId;
    }
    if (!workspace) throw new ConvexError("Authentication required");
    const batch = await ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .unique();
    const result = await ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_resultId", (q) =>
        q.eq("workspaceId", workspace._id).eq("resultId", args.resultId),
      )
      .unique();
    if (!batch || !result || result.batchId !== args.batchId || result.kind !== "photo" || !result.objectKey) {
      throw new ConvexError("Photo not found");
    }
    if (args.operation === "put" && batch.status !== "uploading") {
      throw new ConvexError("Photo upload is no longer allowed");
    }
    if (args.operation === "put" && sourceDeviceId && batch.sourceDeviceId !== sourceDeviceId) {
      throw new ConvexError("Photo belongs to another source");
    }
    if (args.operation === "get" && batch.status !== "ready") {
      throw new ConvexError("Photo is not ready");
    }
    return {
      objectKey: result.objectKey,
      ...(result.contentType ? { contentType: result.contentType } : {}),
      ...(result.checksum ? { checksum: result.checksum } : {}),
    };
  },
});

const authorizePhotoAccessRef = makeFunctionReference<
  "query",
  {
    deviceId?: string;
    deviceSecret?: string;
    guestCloudGrant?: string;
    clerkUserId?: string;
    batchId: string;
    resultId: string;
    operation: "put" | "get";
  },
  PresignAuthorization
>("cloudWorkspace:authorizePhotoAccess");

export const createPhotoUploadUrl = action({
  args: { ...credentialArgs, batchId: v.string(), resultId: v.string() },
  handler: async (ctx, args) => {
    const photo = await ctx.runQuery(authorizePhotoAccessRef, { ...args, operation: "put" });
    return presignR2("PUT", photo.objectKey, photo.contentType);
  },
});

export const createGuestPhotoUploadUrl = action({
  args: { ...guestCredentialArgs, batchId: v.string(), resultId: v.string() },
  handler: async (ctx, args) => {
    const photo = await ctx.runQuery(authorizePhotoAccessRef, { ...args, operation: "put" });
    return presignR2("PUT", photo.objectKey, photo.contentType);
  },
});

export const createPhotoDownloadUrl = action({
  args: {
    deviceId: v.optional(v.string()),
    deviceSecret: v.optional(v.string()),
    batchId: v.string(),
    resultId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const photo = await ctx.runQuery(authorizePhotoAccessRef, {
      ...args,
      ...(identity ? { clerkUserId: identity.subject } : {}),
      operation: "get",
    });
    return presignR2("GET", photo.objectKey);
  },
});

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new ConvexError(`${name} is not configured`);
  return value;
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function hmac(key: Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", Uint8Array.from(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)));
}

export async function presignR2(method: "PUT" | "GET" | "HEAD", objectKey: string, contentType?: string) {
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  const bucket = requiredEnv("R2_BUCKET");
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const credential = `${accessKeyId}/${scope}`;
  const canonicalUri = `/${encodeURIComponent(bucket)}/${encodePath(objectKey)}`;
  const queryParts = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(PRESIGN_TTL_SECONDS)],
    ["X-Amz-SignedHeaders", "host"],
  ] as const;
  const canonicalQuery = queryParts
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), date);
  const kRegion = await hmac(kDate, "auto");
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = Array.from(await hmac(kSigning, stringToSign), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    url: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    method,
    expiresAt: now.getTime() + PRESIGN_TTL_SECONDS * 1000,
    headers: method === "PUT" && contentType ? { "Content-Type": contentType } : {},
  };
}
