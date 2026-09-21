import { v, ConvexError, type ObjectType } from "convex/values";
import { type QueryCtx, type MutationCtx } from "../_generated/server";
import { type Doc } from "../_generated/dataModel";
import { hasFullAppEntitlement, RECONNECT_WINDOW_MS, MAX_SESSION_DURATION_MS } from "../access";

export const ENROLLMENT_TTL_MS = 5 * 60 * 1000;

export const APP_CLIP_GRANT_TTL_MS = 8 * 60 * 60 * 1000;

export const credentialArgs = { deviceId: v.string(), deviceSecret: v.string() };

export const guestCredentialArgs = { guestCloudGrant: v.string() };

export type DatabaseReaderCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export type Principal = {
  workspace: Doc<"workspaces">;
  sourceDeviceId: string;
  device?: Doc<"workspaceDevices">;
  guestGrant?: Doc<"workspaceGuestGrants">;
};

export type DeviceCredential = { deviceId: string; deviceSecret: string };

export type GuestCredential = { guestCloudGrant: string };

export function randomOpaqueSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function sha256Hex(value: string | Uint8Array) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function workspaceForUser(ctx: DatabaseReaderCtx, clerkUserId: string) {
  return ctx.db
    .query("workspaces")
    .withIndex("by_ownerClerkUserId", (q) => q.eq("ownerClerkUserId", clerkUserId))
    .unique();
}

export async function requireFullAppEntitlement(ctx: DatabaseReaderCtx, clerkUserId: string) {
  if (!(await hasFullAppEntitlement(ctx, clerkUserId))) {
    throw new ConvexError("Volt Pro subscription or complimentary access required");
  }
}

export async function requireAuthenticatedWorkspace(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  await requireFullAppEntitlement(ctx, identity.subject);
  const workspace = await workspaceForUser(ctx, identity.subject);
  if (!workspace) throw new ConvexError("Workspace has not been created");
  return workspace;
}

// Only mutations create a workspace, so an account that has signed in but never
// captured anything owns no workspace row at all. Reading that state is not an
// error — it is an empty timeline — and treating it as one made every new
// account's first sign-in look like a broken sync.
export async function authenticatedWorkspaceOrNull(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  await requireFullAppEntitlement(ctx, identity.subject);
  return await workspaceForUser(ctx, identity.subject);
}

export async function requireOrCreateAuthenticatedWorkspace(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  await requireFullAppEntitlement(ctx, identity.subject);
  return requireOrCreateWorkspaceForClerkUser(ctx, identity.subject, identity.name);
}

export async function requireOrCreateAuthenticatedWorkspaceForDeviceBootstrap(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  return requireOrCreateWorkspaceForClerkUser(ctx, identity.subject, identity.name);
}

export async function requireOrCreateWorkspaceForClerkUser(
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

export async function requireDevicePrincipal(
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
  await requireFullAppEntitlement(ctx, workspace.ownerClerkUserId);
  return { workspace, sourceDeviceId: device.deviceId, device };
}

export async function requireGuestPrincipal(
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

  if (grant.usageSessionId !== undefined || grant.scannerJoinTokenId !== undefined) {
    if (grant.usageSessionId === undefined || grant.scannerJoinTokenId === undefined) {
      throw new ConvexError("Guest cloud session is malformed");
    }
    const usageSessionId = grant.usageSessionId;
    const scannerJoinTokenId = grant.scannerJoinTokenId;
    const usageSession = await ctx.db
      .query("usageSessions")
      .withIndex("by_usageSessionId", (q) => q.eq("usageSessionId", usageSessionId))
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
      const joinToken = await ctx.db.get(scannerJoinTokenId);
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
  }

  const workspace = await ctx.db.get(grant.workspaceId);
  if (!workspace || workspace.ownerClerkUserId !== grant.createdByClerkUserId) {
    throw new ConvexError("Guest cloud workspace no longer exists");
  }
  return { workspace, sourceDeviceId: grant.sourceDeviceId, guestGrant: grant };
}

export const ensureWorkspaceArgs = {};
export const ensureWorkspaceHandler = async (ctx: MutationCtx) => requireOrCreateAuthenticatedWorkspace(ctx);

export const createGuestGrantArgs = {
    clerkUserId: v.string(),
    joinToken: v.string(),
    usageSessionId: v.string(),
  };
export const createGuestGrantHandler = async (ctx: MutationCtx, args: ObjectType<typeof createGuestGrantArgs>) => {
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
  };

export const createAppClipWorkspaceGrantForHttpArgs = {
    clerkUserId: v.string(),
    ownerName: v.optional(v.string()),
  };
export const createAppClipWorkspaceGrantForHttpReturns = v.object({
    guestCloudGrant: v.string(),
    expiresAt: v.number(),
  });
export const createAppClipWorkspaceGrantForHttpHandler = async (ctx: MutationCtx, args: ObjectType<typeof createAppClipWorkspaceGrantForHttpArgs>) => {
    const workspace = await requireOrCreateWorkspaceForClerkUser(
      ctx,
      args.clerkUserId,
      args.ownerName,
    );
    const now = Date.now();
    const existing = await ctx.db
      .query("workspaceGuestGrants")
      .withIndex("by_createdByClerkUserId", (q) =>
        q.eq("createdByClerkUserId", args.clerkUserId),
      )
      .order("desc")
      .take(20);
    for (const grant of existing) {
      if (
        grant.scannerJoinTokenId === undefined
        && grant.usageSessionId === undefined
        && grant.revokedAt === undefined
      ) {
        await ctx.db.patch(grant._id, { revokedAt: now });
      }
    }

    const guestCloudGrant = randomOpaqueSecret();
    const expiresAt = now + APP_CLIP_GRANT_TTL_MS;
    await ctx.db.insert("workspaceGuestGrants", {
      workspaceId: workspace._id,
      createdByClerkUserId: args.clerkUserId,
      grantHash: await sha256Hex(guestCloudGrant),
      sourceDeviceId: `appclip:${crypto.randomUUID()}`,
      createdAt: now,
      expiresAt,
    });
    return { guestCloudGrant, expiresAt };
  };
