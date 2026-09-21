import { v, ConvexError, type ObjectType } from "convex/values";
import {
  requireOrCreateAuthenticatedWorkspace,
  randomOpaqueSecret,
  sha256Hex,
  ENROLLMENT_TTL_MS,
  requireFullAppEntitlement,
  requireOrCreateAuthenticatedWorkspaceForDeviceBootstrap,
  requireOrCreateWorkspaceForClerkUser,
  credentialArgs,
  requireDevicePrincipal,
  type DatabaseReaderCtx,
  guestCredentialArgs,
  requireGuestPrincipal,
  requireAuthenticatedWorkspace,
} from "./identity";
import { hasFullAppEntitlement } from "../access";
import { type Id } from "../_generated/dataModel";
import { type MutationCtx, type QueryCtx } from "../_generated/server";

const CANONICAL_CAPABILITIES = new Set([
  "workspace-results",
  "cursor-insertion",
  "photo-download",
]);

const deviceKind = v.union(v.literal("ios"), v.literal("chrome"));

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

export const createEnrollmentArgs = { kind: deviceKind, label: v.string() };
export const createEnrollmentHandler = async (ctx: MutationCtx, args: ObjectType<typeof createEnrollmentArgs>) => {
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
  };

export const exchangeEnrollmentArgs = { enrollmentCode: v.string(), label: v.optional(v.string()) };
export const exchangeEnrollmentHandler = async (ctx: MutationCtx, args: ObjectType<typeof exchangeEnrollmentArgs>) => {
    const codeHash = await sha256Hex(args.enrollmentCode);
    const enrollment = await ctx.db
      .query("workspaceEnrollments")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
      .unique();
    const now = Date.now();
    if (!enrollment || enrollment.consumedAt || enrollment.expiresAt <= now) {
      throw new ConvexError("Enrollment code is invalid, expired, or already used");
    }
    const workspace = await ctx.db.get(enrollment.workspaceId);
    if (!workspace) throw new ConvexError("Workspace no longer exists");
    await requireFullAppEntitlement(ctx, workspace.ownerClerkUserId);
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
  };

export const bootstrapMobileDeviceArgs = {
    installationId: v.string(),
    label: v.string(),
    existingDeviceId: v.optional(v.string()),
  };
export const bootstrapMobileDeviceHandler = async (ctx: MutationCtx, args: ObjectType<typeof bootstrapMobileDeviceArgs>) => {
    if (!args.installationId.trim() || !args.label.trim()) {
      throw new ConvexError("Installation id and label are required");
    }
    const workspace = await requireOrCreateAuthenticatedWorkspaceForDeviceBootstrap(ctx);
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
  };

export const registerComputerArgs = {
    installationId: v.string(),
    label: v.string(),
    capabilities: v.optional(v.array(v.string())),
    ttlMs: v.optional(v.number()),
  };
export const registerComputerHandler = async (ctx: MutationCtx, args: ObjectType<typeof registerComputerArgs>) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");
    // Registration is a presence heartbeat, not an authorization boundary.
    // Returning success without writing for locked accounts lets old clients
    // terminate their retry chain while every workspace read stays protected.
    if (!(await hasFullAppEntitlement(ctx, identity.subject))) return null;
    const workspace = await requireOrCreateWorkspaceForClerkUser(
      ctx,
      identity.subject,
      identity.name,
    );
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
  };

export const revokeDeviceArgs = { deviceId: v.string() };
export const revokeDeviceHandler = async (ctx: MutationCtx, args: ObjectType<typeof revokeDeviceArgs>) => {
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
  };

export const updatePresenceArgs = { ...credentialArgs, capabilities: v.array(v.string()), ttlMs: v.number() };
export const updatePresenceHandler = async (ctx: MutationCtx, args: ObjectType<typeof updatePresenceArgs>) => {
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
  };

// Convex subscriptions only re-fire on writes, so a client that dies silently
// (no revokeDevice call) would otherwise show as online forever since
// listComputersForDevice only evaluates expiresAt at read time. This sweep
// forces a write once a lease expires so subscribers observe the flip.
export const sweepExpiredPresenceArgs = {};
export const sweepExpiredPresenceHandler = async (ctx: MutationCtx) => {
    const now = Date.now();
    const presence = await ctx.db.query("workspacePresence").collect();
    for (const item of presence) {
      if (item.state === "online" && item.expiresAt <= now) {
        await ctx.db.patch(item._id, { state: "offline" });
      }
    }
  };

export const listComputersForDeviceArgs = credentialArgs;
export const listComputersForDeviceHandler = async (ctx: QueryCtx, args: ObjectType<typeof listComputersForDeviceArgs>) => {
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
  };

async function listWorkspaceComputers(ctx: DatabaseReaderCtx, workspaceId: Id<"workspaces">) {
  const devices = await ctx.db
    .query("workspaceDevices")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const presence = await ctx.db
    .query("workspacePresence")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const byDevice = new Map(presence.map((item) => [item.deviceId, item]));
  const now = Date.now();
  return devices.filter((item) => item.kind === "chrome" && !item.revokedAt).map((item) => {
    const current = byDevice.get(item.deviceId);
    return {
      deviceId: item.deviceId,
      label: item.label,
      capabilities: normalizeCapabilities(current?.capabilities ?? []),
      online: Boolean(current && current.state === "online" && current.expiresAt > now),
    };
  });
}

export const listComputersForGuestArgs = guestCredentialArgs;
export const listComputersForGuestHandler = async (ctx: QueryCtx, args: ObjectType<typeof listComputersForGuestArgs>) => {
    const { workspace } = await requireGuestPrincipal(ctx, args);
    return { computers: await listWorkspaceComputers(ctx, workspace._id) };
  };

export const setCursorTargetArgs = { ...credentialArgs, cursorTargetDeviceId: v.union(v.string(), v.null()) };
export const setCursorTargetHandler = async (ctx: MutationCtx, args: ObjectType<typeof setCursorTargetArgs>) => {
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
  };

export const listComputersArgs = {};
export const listComputersHandler = async (ctx: QueryCtx) => {
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
  };
