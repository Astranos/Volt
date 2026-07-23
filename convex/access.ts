import { v } from "convex/values";
import type { UserIdentity } from "convex/server";

import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";

export const FREE_SESSION_LIMIT = 5;
export const RECONNECT_WINDOW_MS = 30 * 60 * 1000;
export const MAX_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
export const DEFAULT_STOREKIT_PRODUCT_ID = "com.volt.mobile.pro.monthly";
const COMPLIMENTARY_EMAIL_ENTITLEMENT_PREFIX = "complimentary-email:";
const COMPLIMENTARY_ACCOUNT_EMAILS = new Set(["juanquenga@gmail.com"]);
const COMPLIMENTARY_ACCOUNT_DOMAINS = new Set(["paymore.com"]);

export type ClerkAuthContext = {
  clerkUserId?: string;
  tokenIdentifier?: string;
  organizationId?: string;
  organizationName?: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
};

type AccessSource = "trial" | "complimentary" | "subscription";
type SubscriptionStatus = "none" | "active" | "expired";

export type AccessStatus = {
  access: AccessSource | "exhausted";
  isAuthorized: boolean;
  freeSessionsRemaining: number;
  requiresSignIn: boolean;
  requiresSubscription: boolean;
  subscriptionStatus: SubscriptionStatus;
  productId: string;
  clerkUserId?: string;
  organizationId?: string;
  appAccountToken?: string;
  expiresAt?: number;
};

const optionalString = v.optional(v.string());
const authArgs = {
  clerkUserId: optionalString,
  tokenIdentifier: optionalString,
  organizationId: optionalString,
  organizationName: optionalString,
  email: optionalString,
  emailVerified: v.optional(v.boolean()),
  name: optionalString,
};
const anonymousArgs = {
  anonymousId: optionalString,
  anonymousSecret: optionalString,
};

function stringClaim(identity: UserIdentity, key: string) {
  const value = identity[key];
  return typeof value === "string" && value ? value : undefined;
}

function nestedOrganizationClaim(identity: UserIdentity, key: string) {
  const organization = identity.o;
  if (!organization || typeof organization !== "object" || Array.isArray(organization)) return undefined;
  const value = (organization as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

function booleanClaim(identity: UserIdentity, key: string) {
  const value = identity[key];
  return typeof value === "boolean" ? value : undefined;
}

export function clerkAuthContextFromIdentity(identity: UserIdentity | null): ClerkAuthContext {
  if (!identity) return {};
  return {
    clerkUserId: identity.subject,
    tokenIdentifier: identity.tokenIdentifier,
    organizationId:
      stringClaim(identity, "org_id") ??
      stringClaim(identity, "organization_id") ??
      nestedOrganizationClaim(identity, "id"),
    organizationName:
      stringClaim(identity, "org_name") ??
      stringClaim(identity, "organization_name") ??
      nestedOrganizationClaim(identity, "name"),
    ...(identity.email ? { email: identity.email } : {}),
    ...(booleanClaim(identity, "email_verified") !== undefined
      ? { emailVerified: booleanClaim(identity, "email_verified") }
      : {}),
    ...(identity.name ? { name: identity.name } : {}),
  };
}

export function storeKitProductId() {
  return process.env.STOREKIT_PRODUCT_ID || DEFAULT_STOREKIT_PRODUCT_ID;
}

export function isComplimentaryAccountEmail(email: string | undefined) {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator === normalized.length - 1) return false;
  return COMPLIMENTARY_ACCOUNT_EMAILS.has(normalized)
    || COMPLIMENTARY_ACCOUNT_DOMAINS.has(normalized.slice(separator + 1));
}

function randomUuid() {
  return crypto.randomUUID();
}

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hashSecret(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function userByClerkId(ctx: MutationCtx, clerkUserId: string) {
  return ctx.db
    .query("users")
    .withIndex("by_clerkUserId", (query) => query.eq("clerkUserId", clerkUserId))
    .unique();
}

async function grantByAnonymousId(ctx: MutationCtx, anonymousId: string) {
  return ctx.db
    .query("anonymousTrialGrants")
    .withIndex("by_anonymousId", (query) => query.eq("anonymousId", anonymousId))
    .unique();
}

async function usageById(ctx: MutationCtx, usageSessionId: string) {
  return ctx.db
    .query("usageSessions")
    .withIndex("by_usageSessionId", (query) => query.eq("usageSessionId", usageSessionId))
    .unique();
}

async function syncComplimentaryEmailEntitlement(
  ctx: MutationCtx,
  clerkUserId: string,
  email: string | undefined,
  emailVerified: boolean | undefined,
  now: number,
) {
  if (!email) return;
  const normalizedEmail = email.trim().toLowerCase();
  const sourceIdentifier = `${COMPLIMENTARY_EMAIL_ENTITLEMENT_PREFIX}${normalizedEmail}`;
  const eligible = emailVerified === true && isComplimentaryAccountEmail(normalizedEmail);
  const entitlements = await ctx.db
    .query("entitlements")
    .withIndex("by_clerkUserId", (query) => query.eq("clerkUserId", clerkUserId))
    .take(100);
  const complimentaryEntitlements = entitlements.filter(
    (entitlement) => entitlement.kind === "manual"
      && entitlement.sourceIdentifier.startsWith(COMPLIMENTARY_EMAIL_ENTITLEMENT_PREFIX),
  );

  for (const entitlement of complimentaryEntitlements) {
    if ((!eligible || entitlement.sourceIdentifier !== sourceIdentifier) && entitlement.status === "active") {
      await ctx.db.patch(entitlement._id, { status: "revoked", updatedAt: now });
    }
  }
  if (!eligible) return;

  const existing = complimentaryEntitlements.find(
    (entitlement) => entitlement.sourceIdentifier === sourceIdentifier,
  );
  if (existing) {
    if (existing.status !== "active" || existing.expiresAt !== undefined) {
      await ctx.db.patch(existing._id, {
        status: "active",
        expiresAt: undefined,
        productId: storeKitProductId(),
        updatedAt: now,
      });
    }
    return;
  }

  await ctx.db.insert("entitlements", {
    clerkUserId,
    kind: "manual",
    sourceIdentifier,
    productId: storeKitProductId(),
    status: "active",
    validFrom: now,
    updatedAt: now,
  });
}

async function ensureUser(ctx: MutationCtx, auth: ClerkAuthContext, now: number) {
  if (!auth.clerkUserId || !auth.tokenIdentifier) return null;
  const existing = await userByClerkId(ctx, auth.clerkUserId);
  if (existing) {
    const updates = {
      tokenIdentifier: auth.tokenIdentifier,
      ...(auth.email ? { email: auth.email } : {}),
      ...(auth.name ? { name: auth.name } : {}),
      updatedAt: now,
    };
    await ctx.db.patch(existing._id, updates);
    await syncComplimentaryEmailEntitlement(
      ctx,
      existing.clerkUserId,
      auth.email,
      auth.emailVerified,
      now,
    );
    return { ...existing, ...updates };
  }

  const id = await ctx.db.insert("users", {
    clerkUserId: auth.clerkUserId,
    tokenIdentifier: auth.tokenIdentifier,
    appAccountToken: randomUuid(),
    ...(auth.email ? { email: auth.email } : {}),
    ...(auth.name ? { name: auth.name } : {}),
    freeSessionsConsumed: 0,
    createdAt: now,
    updatedAt: now,
  });
  const user = await ctx.db.get(id);
  if (user) {
    await syncComplimentaryEmailEntitlement(
      ctx,
      user.clerkUserId,
      auth.email,
      auth.emailVerified,
      now,
    );
  }
  return user;
}

async function validateAnonymousGrant(
  ctx: MutationCtx,
  anonymousId: string | undefined,
  anonymousSecret: string | undefined,
) {
  if (!anonymousId || !anonymousSecret) return null;
  const grant = await grantByAnonymousId(ctx, anonymousId);
  if (!grant || grant.credentialHash !== (await hashSecret(anonymousSecret))) return null;
  return grant;
}

async function mergeAnonymousGrant(
  ctx: MutationCtx,
  user: Doc<"users">,
  grant: Doc<"anonymousTrialGrants">,
  now: number,
) {
  if (grant.claimedByClerkUserId && grant.claimedByClerkUserId !== user.clerkUserId) {
    return { ok: false as const, error: "Anonymous trial is already claimed" };
  }
  if (grant.claimedByClerkUserId === user.clerkUserId) return { ok: true as const, user };

  const freeSessionsConsumed = Math.min(
    FREE_SESSION_LIMIT,
    user.freeSessionsConsumed + grant.sessionsConsumed,
  );
  await ctx.db.patch(grant._id, { claimedByClerkUserId: user.clerkUserId, updatedAt: now });
  await ctx.db.patch(user._id, { freeSessionsConsumed, updatedAt: now });

  const anonymousSessions = await ctx.db
    .query("usageSessions")
    .withIndex("by_anonymousId", (query) => query.eq("anonymousId", grant.anonymousId))
    .take(100);
  for (const session of anonymousSessions) {
    await ctx.db.patch(session._id, {
      ownerType: "user",
      clerkUserId: user.clerkUserId,
    });
  }
  return { ok: true as const, user: { ...user, freeSessionsConsumed } };
}

async function ensureConfiguredOrganizationEntitlement(
  ctx: MutationCtx,
  organizationId: string | undefined,
  organizationName: string | undefined,
  now: number,
) {
  if (!organizationId) return null;
  const configuredId = process.env.CLERK_COMPLIMENTARY_ORGANIZATION_ID;
  if (!configuredId || configuredId !== organizationId) return null;
  let entitlement = await ctx.db
    .query("organizationEntitlements")
    .withIndex("by_clerkOrganizationId", (query) => query.eq("clerkOrganizationId", organizationId))
    .unique();

  if (!entitlement) {
    const id = await ctx.db.insert("organizationEntitlements", {
      clerkOrganizationId: organizationId,
      ...(organizationName ? { displayName: organizationName } : {}),
      status: "active",
      source: "complimentary",
      createdAt: now,
      updatedAt: now,
    });
    entitlement = await ctx.db.get(id);
  } else if (entitlement.status !== "active") {
    await ctx.db.patch(entitlement._id, {
      status: "active",
      ...(organizationName ? { displayName: organizationName } : {}),
      updatedAt: now,
    });
    entitlement = await ctx.db.get(entitlement._id);
  }
  return entitlement?.status === "active" ? entitlement : null;
}

async function subscriptionForUser(ctx: MutationCtx, clerkUserId: string, now: number) {
  const entitlements = await ctx.db
    .query("entitlements")
    .withIndex("by_clerkUserId", (query) => query.eq("clerkUserId", clerkUserId))
    .take(100);
  const activeComplimentary = entitlements.find(
    (entitlement) => entitlement.kind === "manual"
      && entitlement.status === "active"
      && (entitlement.expiresAt === undefined || entitlement.expiresAt > now),
  );
  if (activeComplimentary) {
    return {
      status: "active" as const,
      entitlement: activeComplimentary,
      source: "complimentary" as const,
    };
  }
  const storeKitEntitlements = entitlements.filter((entitlement) => entitlement.kind === "storekit");
  const active = storeKitEntitlements
    .filter(
      (entitlement) =>
        entitlement.status === "active" &&
        (entitlement.expiresAt === undefined || entitlement.expiresAt > now),
    )
    .sort((left, right) => (right.expiresAt ?? Number.MAX_SAFE_INTEGER) - (left.expiresAt ?? Number.MAX_SAFE_INTEGER))[0];
  if (active) {
    return { status: "active" as const, entitlement: active, source: "subscription" as const };
  }
  return { status: storeKitEntitlements.length ? ("expired" as const) : ("none" as const) };
}

type ResolvedPrincipal = {
  user?: Doc<"users">;
  grant?: Doc<"anonymousTrialGrants">;
};

async function resolvePrincipal(
  ctx: MutationCtx,
  auth: ClerkAuthContext,
  anonymousId: string | undefined,
  anonymousSecret: string | undefined,
  now: number,
): Promise<{ ok: true; principal: ResolvedPrincipal } | { ok: false; statusCode: number; error: string }> {
  const user = await ensureUser(ctx, auth, now);
  const hasAnonymousCredentials = Boolean(anonymousId || anonymousSecret);
  if (hasAnonymousCredentials && (!anonymousId || !anonymousSecret)) {
    return { ok: false, statusCode: 400, error: "Both anonymous id and secret are required" };
  }
  const grant = hasAnonymousCredentials
    ? await validateAnonymousGrant(ctx, anonymousId, anonymousSecret)
    : null;
  if (hasAnonymousCredentials && !grant && !user) {
    return { ok: false, statusCode: 401, error: "Invalid anonymous trial credentials" };
  }

  if (user && grant) {
    if (
      grant.claimedByClerkUserId &&
      grant.claimedByClerkUserId !== user.clerkUserId
    ) {
      return { ok: true, principal: { user } };
    }
    const merged = await mergeAnonymousGrant(ctx, user, grant, now);
    if (!merged.ok) return { ok: false, statusCode: 409, error: merged.error };
    return { ok: true, principal: { user: merged.user, grant } };
  }
  if (user) return { ok: true, principal: { user } };
  if (grant && !grant.claimedByClerkUserId) return { ok: true, principal: { grant } };
  if (grant?.claimedByClerkUserId) {
    return { ok: false, statusCode: 401, error: "Sign in to use this claimed trial" };
  }
  return { ok: false, statusCode: 401, error: "Authentication or anonymous trial credentials required" };
}

async function buildAccessStatus(
  ctx: MutationCtx,
  auth: ClerkAuthContext,
  principal: ResolvedPrincipal,
  now: number,
): Promise<AccessStatus> {
  const freeSessionsConsumed = principal.user?.freeSessionsConsumed ?? principal.grant?.sessionsConsumed ?? 0;
  const freeSessionsRemaining = Math.max(0, FREE_SESSION_LIMIT - freeSessionsConsumed);
  const organization = principal.user
    ? await ensureConfiguredOrganizationEntitlement(ctx, auth.organizationId, auth.organizationName, now)
    : null;
  const subscription = principal.user
    ? await subscriptionForUser(ctx, principal.user.clerkUserId, now)
    : { status: "none" as const };
  const shared = {
    freeSessionsRemaining,
    productId: storeKitProductId(),
    subscriptionStatus: subscription.status,
    ...(principal.user
      ? {
          clerkUserId: principal.user.clerkUserId,
          appAccountToken: principal.user.appAccountToken,
        }
      : {}),
    ...(auth.organizationId ? { organizationId: auth.organizationId } : {}),
  };

  if (organization || (subscription.status === "active" && subscription.source === "complimentary")) {
    return {
      ...shared,
      access: "complimentary",
      isAuthorized: true,
      requiresSignIn: false,
      requiresSubscription: false,
    };
  }
  if (subscription.status === "active") {
    return {
      ...shared,
      access: "subscription",
      isAuthorized: true,
      requiresSignIn: false,
      requiresSubscription: false,
      ...(subscription.entitlement.expiresAt !== undefined
        ? { expiresAt: subscription.entitlement.expiresAt }
        : {}),
    };
  }
  if (freeSessionsRemaining > 0) {
    return {
      ...shared,
      access: "trial",
      isAuthorized: true,
      requiresSignIn: false,
      requiresSubscription: false,
    };
  }
  return {
    ...shared,
    access: "exhausted",
    isAuthorized: false,
    requiresSignIn: !principal.user,
    requiresSubscription: Boolean(principal.user),
  };
}

async function expirePrincipalSessions(
  ctx: MutationCtx,
  principal: ResolvedPrincipal,
  now: number,
) {
  const sessions = principal.user
    ? await ctx.db
        .query("usageSessions")
        .withIndex("by_clerkUserId", (query) => query.eq("clerkUserId", principal.user?.clerkUserId))
        .order("desc")
        .take(100)
    : await ctx.db
        .query("usageSessions")
        .withIndex("by_anonymousId", (query) => query.eq("anonymousId", principal.grant?.anonymousId))
        .order("desc")
        .take(100);
  for (const session of sessions) {
    if (session.endedAt) continue;
    if (now - session.startedAt >= MAX_SESSION_DURATION_MS) {
      await ctx.db.patch(session._id, {
        endedAt: session.startedAt + MAX_SESSION_DURATION_MS,
        endedReason: "max_duration",
      });
    } else if (session.disconnectedAt && now - session.disconnectedAt >= RECONNECT_WINDOW_MS) {
      await ctx.db.patch(session._id, {
        endedAt: session.disconnectedAt + RECONNECT_WINDOW_MS,
        endedReason: "disconnected_timeout",
      });
    }
  }
}

async function statusForRequest(
  ctx: MutationCtx,
  auth: ClerkAuthContext,
  anonymousId: string | undefined,
  anonymousSecret: string | undefined,
  now = Date.now(),
) {
  const resolved = await resolvePrincipal(ctx, auth, anonymousId, anonymousSecret, now);
  if (!resolved.ok) return { statusCode: resolved.statusCode, body: { error: resolved.error } };
  await expirePrincipalSessions(ctx, resolved.principal, now);
  return {
    statusCode: 200,
    body: await buildAccessStatus(ctx, auth, resolved.principal, now),
    principal: resolved.principal,
  };
}

async function authFromMutation(ctx: MutationCtx) {
  return clerkAuthContextFromIdentity(await ctx.auth.getUserIdentity());
}

export const anonymousTrial = mutation({
  args: anonymousArgs,
  handler: async (ctx, args) => {
    const auth = await authFromMutation(ctx);
    if (args.anonymousId || args.anonymousSecret) {
      return statusForRequest(ctx, auth, args.anonymousId, args.anonymousSecret);
    }
    const now = Date.now();
    const anonymousId = randomUuid();
    const anonymousSecret = randomSecret();
    await ctx.db.insert("anonymousTrialGrants", {
      anonymousId,
      credentialHash: await hashSecret(anonymousSecret),
      freeSessionLimit: FREE_SESSION_LIMIT,
      sessionsConsumed: 0,
      createdAt: now,
      updatedAt: now,
    });
    const response = await statusForRequest(ctx, auth, anonymousId, anonymousSecret, now);
    return {
      ...response,
      body: {
        ...response.body,
        anonymousId,
        anonymousSecret,
      },
    };
  },
});

export const getStatus = mutation({
  args: anonymousArgs,
  handler: async (ctx, args) =>
    statusForRequest(
      ctx,
      await authFromMutation(ctx),
      args.anonymousId,
      args.anonymousSecret,
    ),
});

export const getStatusForHttp = internalMutation({
  args: { ...authArgs, ...anonymousArgs },
  handler: (ctx, args) =>
    statusForRequest(ctx, args, args.anonymousId, args.anonymousSecret),
});

export const anonymousTrialForHttp = internalMutation({
  args: { ...authArgs, ...anonymousArgs },
  handler: async (ctx, args) => {
    if (args.anonymousId || args.anonymousSecret) {
      return statusForRequest(ctx, args, args.anonymousId, args.anonymousSecret);
    }
    const now = Date.now();
    const anonymousId = randomUuid();
    const anonymousSecret = randomSecret();
    await ctx.db.insert("anonymousTrialGrants", {
      anonymousId,
      credentialHash: await hashSecret(anonymousSecret),
      freeSessionLimit: FREE_SESSION_LIMIT,
      sessionsConsumed: 0,
      createdAt: now,
      updatedAt: now,
    });
    const response = await statusForRequest(ctx, args, anonymousId, anonymousSecret, now);
    return {
      ...response,
      body: { ...response.body, anonymousId, anonymousSecret },
    };
  },
});

export const authorizeJoinToken = internalMutation({
  args: { ...authArgs, ...anonymousArgs, usageSessionId: v.string() },
  handler: async (ctx, args) => {
    const response = await statusForRequest(ctx, args, args.anonymousId, args.anonymousSecret);
    if (response.statusCode !== 200) {
      return {
        statusCode: response.statusCode,
        body: response.body,
      };
    }
    const existing = await usageById(ctx, args.usageSessionId);
    const reconnectAllowed = Boolean(
      existing &&
        response.principal &&
        sessionOwnedBy(existing, response.principal) &&
        !existing.endedAt &&
        Date.now() - existing.startedAt < MAX_SESSION_DURATION_MS &&
        (!existing.disconnectedAt || Date.now() - existing.disconnectedAt < RECONNECT_WINDOW_MS),
    );
    if (!("isAuthorized" in response.body) || (!response.body.isAuthorized && !reconnectAllowed)) {
      return { statusCode: 402, body: response.body };
    }
    return {
      statusCode: 200,
      body: response.body,
      owner: response.principal?.user
        ? { clerkUserId: response.principal.user.clerkUserId }
        : { anonymousId: response.principal?.grant?.anonymousId },
    };
  },
});

function sessionOwnedBy(
  session: Doc<"usageSessions">,
  principal: ResolvedPrincipal,
) {
  if (session.clerkUserId && principal.user?.clerkUserId === session.clerkUserId) return true;
  if (session.anonymousId && principal.grant?.anonymousId === session.anonymousId) return true;
  return false;
}

async function consumeSessionReady(
  ctx: MutationCtx,
  auth: ClerkAuthContext,
  anonymousId: string | undefined,
  anonymousSecret: string | undefined,
  token: string,
  suppliedUsageSessionId?: string,
) {
  const now = Date.now();
  const joinToken = await ctx.db
    .query("scannerJoinTokens")
    .withIndex("by_token", (query) => query.eq("token", token))
    .unique();
  if (!joinToken || joinToken.revokedAt || now >= joinToken.graceExpiresAt) {
    return { statusCode: 404, body: { error: "Join token not found" } };
  }
  if (!joinToken.usageSessionId) {
    return { statusCode: 409, body: { error: "Join token has no usage session" } };
  }
  if (suppliedUsageSessionId && suppliedUsageSessionId !== joinToken.usageSessionId) {
    return { statusCode: 409, body: { error: "Usage session does not match join token" } };
  }

  const resolved = await resolvePrincipal(ctx, auth, anonymousId, anonymousSecret, now);
  if (!resolved.ok) return { statusCode: resolved.statusCode, body: { error: resolved.error } };
  const { principal } = resolved;
  const tokenOwnedByPrincipal =
    (joinToken.clerkUserId && principal.user?.clerkUserId === joinToken.clerkUserId) ||
    (joinToken.anonymousId && principal.grant?.anonymousId === joinToken.anonymousId) ||
    (joinToken.anonymousId && principal.user && principal.grant?.claimedByClerkUserId === principal.user.clerkUserId);
  if (!tokenOwnedByPrincipal) return { statusCode: 403, body: { error: "Join token belongs to another account" } };

  const existing = await usageById(ctx, joinToken.usageSessionId);
  if (existing) {
    if (!sessionOwnedBy(existing, principal)) {
      return { statusCode: 403, body: { error: "Usage session belongs to another account" } };
    }
    if (now - existing.startedAt >= MAX_SESSION_DURATION_MS) {
      if (!existing.endedAt) {
        await ctx.db.patch(existing._id, {
          endedAt: existing.startedAt + MAX_SESSION_DURATION_MS,
          endedReason: "max_duration",
        });
      }
      return { statusCode: 409, body: { error: "Usage session reached its 8-hour maximum" } };
    }
    if (existing.endedAt) {
      return { statusCode: 409, body: { error: "Usage session has ended" } };
    }
    if (existing.disconnectedAt && now - existing.disconnectedAt >= RECONNECT_WINDOW_MS) {
      await ctx.db.patch(existing._id, {
        endedAt: existing.disconnectedAt + RECONNECT_WINDOW_MS,
        endedReason: "disconnected_timeout",
      });
      return { statusCode: 409, body: { error: "Reconnect window expired" } };
    }
    const resumed = existing.disconnectedAt !== undefined;
    await ctx.db.patch(existing._id, { lastConnectedAt: now, disconnectedAt: undefined });
    const status = await buildAccessStatus(ctx, auth, principal, now);
    return {
      statusCode: 200,
      body: {
        usageSessionId: existing.usageSessionId,
        startedAt: existing.startedAt,
        maxEndsAt: existing.startedAt + MAX_SESSION_DURATION_MS,
        consumed: false,
        idempotent: !resumed,
        resumed,
        status,
      },
    };
  }

  const status = await buildAccessStatus(ctx, auth, principal, now);
  if (!status.isAuthorized) return { statusCode: 402, body: status };
  if (status.access === "trial") {
    if (principal.user) {
      await ctx.db.patch(principal.user._id, {
        freeSessionsConsumed: principal.user.freeSessionsConsumed + 1,
        updatedAt: now,
      });
      principal.user = {
        ...principal.user,
        freeSessionsConsumed: principal.user.freeSessionsConsumed + 1,
      };
    } else if (principal.grant) {
      await ctx.db.patch(principal.grant._id, {
        sessionsConsumed: principal.grant.sessionsConsumed + 1,
        updatedAt: now,
      });
      principal.grant = {
        ...principal.grant,
        sessionsConsumed: principal.grant.sessionsConsumed + 1,
      };
    }
  }
  await ctx.db.insert("usageSessions", {
    usageSessionId: joinToken.usageSessionId,
    browserSessionId: joinToken.sessionId,
    ownerType: principal.user ? "user" : "anonymous",
    ...(principal.user ? { clerkUserId: principal.user.clerkUserId } : {}),
    ...(principal.grant ? { anonymousId: principal.grant.anonymousId } : {}),
    accessSource: status.access as AccessSource,
    startedAt: now,
    lastConnectedAt: now,
    consumedAt: now,
  });
  return {
    statusCode: 200,
    body: {
      usageSessionId: joinToken.usageSessionId,
      startedAt: now,
      maxEndsAt: now + MAX_SESSION_DURATION_MS,
      consumed: status.access === "trial",
      idempotent: false,
      resumed: false,
      status: await buildAccessStatus(ctx, auth, principal, now),
    },
  };
}

export const sessionReadyForHttp = internalMutation({
  args: {
    ...authArgs,
    ...anonymousArgs,
    token: v.string(),
    usageSessionId: optionalString,
  },
  handler: (ctx, args) =>
    consumeSessionReady(
      ctx,
      args,
      args.anonymousId,
      args.anonymousSecret,
      args.token,
      args.usageSessionId,
    ),
});

async function updateSessionConnectionState(
  ctx: MutationCtx,
  auth: ClerkAuthContext,
  anonymousId: string | undefined,
  anonymousSecret: string | undefined,
  usageSessionId: string,
  end: boolean,
) {
  const now = Date.now();
  const resolved = await resolvePrincipal(ctx, auth, anonymousId, anonymousSecret, now);
  if (!resolved.ok) return { statusCode: resolved.statusCode, body: { error: resolved.error } };
  const session = await usageById(ctx, usageSessionId);
  if (!session) return { statusCode: 404, body: { error: "Usage session not found" } };
  if (!sessionOwnedBy(session, resolved.principal)) {
    return { statusCode: 403, body: { error: "Usage session belongs to another account" } };
  }
  if (session.endedAt) {
    return { statusCode: 200, body: { usageSessionId, ended: true, idempotent: true } };
  }
  if (end) {
    await ctx.db.patch(session._id, { endedAt: now, endedReason: "explicit_disconnect" });
    return { statusCode: 200, body: { usageSessionId, ended: true, idempotent: false } };
  }
  await ctx.db.patch(session._id, { disconnectedAt: session.disconnectedAt ?? now });
  return { statusCode: 200, body: { usageSessionId, ended: false, idempotent: Boolean(session.disconnectedAt) } };
}

export const disconnectSessionForHttp = internalMutation({
  args: { ...authArgs, ...anonymousArgs, usageSessionId: v.string() },
  handler: (ctx, args) =>
    updateSessionConnectionState(
      ctx,
      args,
      args.anonymousId,
      args.anonymousSecret,
      args.usageSessionId,
      false,
    ),
});

export const endSessionForHttp = internalMutation({
  args: { ...authArgs, ...anonymousArgs, usageSessionId: v.string() },
  handler: (ctx, args) =>
    updateSessionConnectionState(
      ctx,
      args,
      args.anonymousId,
      args.anonymousSecret,
      args.usageSessionId,
      true,
    ),
});

export const cleanupUsageSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const openSessions = await ctx.db
      .query("usageSessions")
      .withIndex("by_endedAt", (query) => query.eq("endedAt", undefined))
      .take(500);
    let ended = 0;
    for (const session of openSessions) {
      if (session.endedAt) continue;
      if (now - session.startedAt >= MAX_SESSION_DURATION_MS) {
        await ctx.db.patch(session._id, {
          endedAt: session.startedAt + MAX_SESSION_DURATION_MS,
          endedReason: "max_duration",
        });
        ended += 1;
      } else if (session.disconnectedAt && now - session.disconnectedAt >= RECONNECT_WINDOW_MS) {
        await ctx.db.patch(session._id, {
          endedAt: session.disconnectedAt + RECONNECT_WINDOW_MS,
          endedReason: "disconnected_timeout",
        });
        ended += 1;
      }
    }
    return { ended };
  },
});
