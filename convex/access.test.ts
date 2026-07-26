import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import {
  FREE_SESSION_LIMIT,
  MAX_SESSION_DURATION_MS,
  RECONNECT_WINDOW_MS,
  type AccessStatus,
} from "./access";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Credentials = { anonymousId: string; anonymousSecret: string };
type AccessResult = {
  statusCode: number;
  body: AccessStatus & Partial<Credentials> & { error?: string };
};
type SessionResult = {
  statusCode: number;
  body: {
    error?: string;
    consumed?: boolean;
    idempotent?: boolean;
    resumed?: boolean;
    startedAt?: number;
    maxEndsAt?: number;
    status?: AccessStatus;
  };
};

const anonymousTrial = makeFunctionReference<
  "mutation",
  { anonymousId?: string; anonymousSecret?: string },
  AccessResult
>("access:anonymousTrial");
const getStatus = makeFunctionReference<
  "mutation",
  { anonymousId?: string; anonymousSecret?: string },
  AccessResult
>("access:getStatus");
const authorizeJoinToken = makeFunctionReference<
  "mutation",
  Credentials & { usageSessionId: string },
  AccessResult & { owner?: { anonymousId?: string; clerkUserId?: string } }
>("access:authorizeJoinToken");
const sessionReady = makeFunctionReference<
  "mutation",
  Credentials & { token: string; usageSessionId?: string },
  SessionResult
>("access:sessionReadyForHttp");
const disconnectSession = makeFunctionReference<
  "mutation",
  Credentials & { usageSessionId: string },
  { statusCode: number; body: Record<string, unknown> }
>("access:disconnectSessionForHttp");
const applyTransaction = makeFunctionReference<
  "mutation",
  {
    transactionId: string;
    originalTransactionId: string;
    appAccountToken: string;
    productId: string;
    environment: string;
    purchaseDate: number;
    expiresDate: number;
    signedDate: number;
    revocationDate?: number;
    source: "client" | "notification";
    expectedClerkUserId?: string;
    notification?: {
      notificationUUID: string;
      notificationType: string;
      subtype?: string;
      signedDate?: number;
    };
  },
  { statusCode: number; body: Record<string, unknown> }
>("storeKitData:applyVerifiedTransaction");
const cleanupUsageSessions = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { ended: number }
>("access:cleanupUsageSessions");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function issueCredentials(t: ReturnType<typeof convexTest>): Promise<Credentials> {
  const issued = await t.mutation(anonymousTrial, {});
  expect(issued.statusCode).toBe(200);
  return {
    anonymousId: issued.body.anonymousId as string,
    anonymousSecret: issued.body.anonymousSecret as string,
  };
}

async function createUsageJoinToken(
  t: ReturnType<typeof convexTest>,
  credentials: Credentials,
  sequence: number,
  usageSessionId = `usage-session-${sequence}`,
) {
  const token = `join-token-${sequence.toString().padStart(2, "0")}-abcdefghijklmnopqrstuvwxyz`;
  await t.mutation(internal.scannerSignal.joinTokens.createJoinToken, {
    token,
    sessionId: `browser-session-${sequence}`,
    usageSessionId,
    anonymousId: credentials.anonymousId,
    origin: "https://example.test",
  });
  return { token, usageSessionId };
}

describe("anonymous scanner trial", () => {
  test("counts five successful session-ready events and denies the sixth", async () => {
    const t = convexTest(schema, modules);
    const credentials = await issueCredentials(t);
    let fifthJoin: { token: string; usageSessionId: string } | undefined;

    for (let sequence = 1; sequence <= FREE_SESSION_LIMIT; sequence += 1) {
      const join = await createUsageJoinToken(t, credentials, sequence);
      if (sequence === FREE_SESSION_LIMIT) fifthJoin = join;
      const ready = await t.mutation(sessionReady, { ...credentials, ...join });
      expect(ready).toMatchObject({
        statusCode: 200,
        body: {
          consumed: true,
          idempotent: false,
          status: { freeSessionsRemaining: FREE_SESSION_LIMIT - sequence },
        },
      });
      expect(ready.body.maxEndsAt).toBe((ready.body.startedAt ?? 0) + MAX_SESSION_DURATION_MS);
    }

    const authorization = await t.mutation(authorizeJoinToken, {
      ...credentials,
      usageSessionId: "usage-session-6",
    });
    expect(authorization).toMatchObject({
      statusCode: 402,
      body: {
        access: "exhausted",
        isAuthorized: false,
        freeSessionsRemaining: 0,
        requiresSignIn: true,
      },
    });
    if (!fifthJoin) throw new Error("Fifth usage session was not created");
    await t.mutation(disconnectSession, {
      ...credentials,
      usageSessionId: fifthJoin.usageSessionId,
    });
    const reconnectAuthorization = await t.mutation(authorizeJoinToken, {
      ...credentials,
      usageSessionId: fifthJoin.usageSessionId,
    });
    expect(reconnectAuthorization.statusCode).toBe(200);
    const signedIn = t.withIdentity({ subject: "user_after_trial" });
    const claimed = await signedIn.mutation(getStatus, credentials);
    expect(claimed.body).toMatchObject({
      access: "exhausted",
      requiresSignIn: false,
      requiresSubscription: true,
      freeSessionsRemaining: 0,
    });
  });

  test("does not count join tokens, failed pairings, retries, or a reconnect within 30 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
    const t = convexTest(schema, modules);
    const credentials = await issueCredentials(t);
    await createUsageJoinToken(t, credentials, 1);
    const beforeReady = await t.mutation(getStatus, credentials);
    expect(beforeReady.body.freeSessionsRemaining).toBe(5);
    const expiredToken = "expired-join-token-abcdefghijklmnopqrstuvwxyz";
    await t.mutation(internal.scannerSignal.joinTokens.createJoinToken, {
      token: expiredToken,
      sessionId: "expired-browser-session",
      usageSessionId: "expired-usage-session",
      anonymousId: credentials.anonymousId,
      ttlMs: 1,
      graceMs: 0,
      origin: "https://example.test",
    });
    vi.advanceTimersByTime(1);
    const expiredReady = await t.mutation(sessionReady, {
      ...credentials,
      token: expiredToken,
      usageSessionId: "expired-usage-session",
    });
    expect(expiredReady.statusCode).toBe(404);
    expect((await t.mutation(getStatus, credentials)).body.freeSessionsRemaining).toBe(5);

    const join = await createUsageJoinToken(t, credentials, 2);
    const firstReady = await t.mutation(sessionReady, { ...credentials, ...join });
    expect(firstReady.body.status?.freeSessionsRemaining).toBe(4);
    const duplicateReady = await t.mutation(sessionReady, { ...credentials, ...join });
    expect(duplicateReady.body).toMatchObject({ consumed: false, idempotent: true, resumed: false });

    await t.mutation(disconnectSession, { ...credentials, usageSessionId: join.usageSessionId });
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS - 1);
    const reconnectAuthorization = await t.mutation(authorizeJoinToken, {
      ...credentials,
      usageSessionId: join.usageSessionId,
    });
    expect(reconnectAuthorization.statusCode).toBe(200);
    const reconnectJoin = await createUsageJoinToken(t, credentials, 3, join.usageSessionId);
    const reconnected = await t.mutation(sessionReady, { ...credentials, ...reconnectJoin });
    expect(reconnected.body).toMatchObject({ consumed: false, resumed: true });
    expect(reconnected.body.status?.freeSessionsRemaining).toBe(4);

    const sessions = await t.run((ctx) => ctx.db.query("usageSessions").collect());
    expect(sessions).toHaveLength(1);
  });

  test("consumption is idempotent and a reconnect at 30 minutes is ended", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
    const t = convexTest(schema, modules);
    const credentials = await issueCredentials(t);
    const join = await createUsageJoinToken(t, credentials, 1);
    await t.mutation(sessionReady, { ...credentials, ...join });
    await t.mutation(disconnectSession, { ...credentials, usageSessionId: join.usageSessionId });
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);

    const reconnectJoin = await createUsageJoinToken(t, credentials, 2, join.usageSessionId);
    const result = await t.mutation(sessionReady, { ...credentials, ...reconnectJoin });
    expect(result).toMatchObject({ statusCode: 409, body: { error: "Reconnect window expired" } });
    const grant = await t.run((ctx) =>
      ctx.db
        .query("anonymousTrialGrants")
        .withIndex("by_anonymousId", (query) => query.eq("anonymousId", credentials.anonymousId))
        .unique(),
    );
    expect(grant?.sessionsConsumed).toBe(1);
  });

  test("ends a usage session at the 8-hour maximum without consuming again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
    const t = convexTest(schema, modules);
    const credentials = await issueCredentials(t);
    const join = await createUsageJoinToken(t, credentials, 1);
    await t.mutation(sessionReady, { ...credentials, ...join });
    vi.advanceTimersByTime(MAX_SESSION_DURATION_MS);
    const laterJoin = await createUsageJoinToken(t, credentials, 2, join.usageSessionId);
    const result = await t.mutation(sessionReady, { ...credentials, ...laterJoin });
    expect(result).toMatchObject({
      statusCode: 409,
      body: { error: "Usage session reached its 8-hour maximum" },
    });
    const usage = await t.run((ctx) =>
      ctx.db
        .query("usageSessions")
        .withIndex("by_usageSessionId", (query) => query.eq("usageSessionId", join.usageSessionId))
        .unique(),
    );
    expect(usage).toMatchObject({ endedReason: "max_duration" });
    expect((await t.mutation(getStatus, credentials)).body.freeSessionsRemaining).toBe(4);
  });

  test("cleanup reaches open sessions after more than 500 historical rows", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-10T12:00:00Z").getTime();
    vi.setSystemTime(now);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let sequence = 0; sequence < 501; sequence += 1) {
        await ctx.db.insert("usageSessions", {
          usageSessionId: `historical-${sequence}`,
          ownerType: "anonymous",
          anonymousId: "historical-owner",
          accessSource: "trial",
          startedAt: now - MAX_SESSION_DURATION_MS,
          lastConnectedAt: now - MAX_SESSION_DURATION_MS,
          endedAt: now - 1,
          endedReason: "explicit_disconnect",
          consumedAt: now - MAX_SESSION_DURATION_MS,
        });
      }
      await ctx.db.insert("usageSessions", {
        usageSessionId: "open-after-history",
        ownerType: "anonymous",
        anonymousId: "current-owner",
        accessSource: "trial",
        startedAt: now - RECONNECT_WINDOW_MS - 1,
        lastConnectedAt: now - RECONNECT_WINDOW_MS - 1,
        disconnectedAt: now - RECONNECT_WINDOW_MS,
        consumedAt: now - RECONNECT_WINDOW_MS - 1,
      });
    });

    expect(await t.mutation(cleanupUsageSessions, {})).toEqual({ ended: 1 });
    const session = await t.run((ctx) =>
      ctx.db
        .query("usageSessions")
        .withIndex("by_usageSessionId", (query) => query.eq("usageSessionId", "open-after-history"))
        .unique(),
    );
    expect(session).toMatchObject({ endedReason: "disconnected_timeout" });
  });

  test("rejects anonymous or authenticated join-token authorization without a principal", async () => {
    const t = convexTest(schema, modules);
    const authorization = await t.mutation(
      makeFunctionReference<
        "mutation",
        { usageSessionId: string },
        { statusCode: number; body: { error?: string } }
      >("access:authorizeJoinToken"),
      { usageSessionId: "unauthorized-session" },
    );
    expect(authorization).toEqual({
      statusCode: 401,
      body: { error: "Authentication or anonymous trial credentials required" },
    });
  });
});

describe("account and entitlement access", () => {
  test("merges anonymous usage exactly once into a Clerk user", async () => {
    const t = convexTest(schema, modules);
    const credentials = await issueCredentials(t);
    for (let sequence = 1; sequence <= 2; sequence += 1) {
      const join = await createUsageJoinToken(t, credentials, sequence);
      await t.mutation(sessionReady, { ...credentials, ...join });
    }

    const signedIn = t.withIdentity({ subject: "user_merge", email: "user@example.test" });
    const merged = await signedIn.mutation(getStatus, credentials);
    expect(merged.body).toMatchObject({
      clerkUserId: "user_merge",
      freeSessionsRemaining: 3,
      subscriptionStatus: "none",
    });
    expect(merged.body.appAccountToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const again = await signedIn.mutation(getStatus, credentials);
    expect(again.body.freeSessionsRemaining).toBe(3);
    expect(again.body.appAccountToken).toBe(merged.body.appAccountToken);

    const anonymousOnly = await t.mutation(getStatus, credentials);
    expect(anonymousOnly).toMatchObject({ statusCode: 401 });
    const sessions = await t.run((ctx) => ctx.db.query("usageSessions").collect());
    expect(sessions.every((session) => session.clerkUserId === "user_merge")).toBe(true);
  });

  test("does not let a claimed anonymous grant block a different signed-in account", async () => {
    const t = convexTest(schema, modules);
    const credentials = await issueCredentials(t);
    const join = await createUsageJoinToken(t, credentials, 1);
    await t.mutation(sessionReady, { ...credentials, ...join });

    const firstUser = t.withIdentity({ subject: "user_first" });
    expect((await firstUser.mutation(getStatus, credentials)).body.freeSessionsRemaining).toBe(4);

    const secondUser = t.withIdentity({ subject: "user_second" });
    const secondStatus = await secondUser.mutation(getStatus, credentials);
    expect(secondStatus).toMatchObject({
      statusCode: 200,
      body: {
        clerkUserId: "user_second",
        freeSessionsRemaining: 5,
        access: "trial",
      },
    });

    expect((await firstUser.mutation(getStatus, credentials)).body.freeSessionsRemaining).toBe(4);
  });

  test("does not let stale anonymous credentials block a valid Clerk account", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({
      subject: "user_with_stale_trial",
      tokenIdentifier: "clerk|user_with_stale_trial",
      email: "person@example.com",
    });

    const status = await signedIn.mutation(getStatus, {
      anonymousId: "stale-anonymous-id",
      anonymousSecret: "stale-anonymous-secret",
    });

    expect(status).toMatchObject({
      statusCode: 200,
      body: {
        clerkUserId: "user_with_stale_trial",
        access: "trial",
        isAuthorized: true,
      },
    });
  });

  test.each([
    ["juanquenga@gmail.com", true, true],
    ["JUANQUENGA@GMAIL.COM", true, true],
    ["manager@paymore.com", true, true],
    ["MANAGER@PAYMORE.COM", true, true],
    ["unverified@paymore.com", false, false],
    ["manager@sub.paymore.com", true, false],
    ["manager@paymore.com.evil.test", true, false],
    ["manager@notpaymore.com", true, false],
  ])("resolves complimentary paid access for %s", async (email, emailVerified, complimentary) => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({
      subject: `user_${email.toLowerCase()}`,
      tokenIdentifier: `clerk|${email.toLowerCase()}`,
      email,
      email_verified: emailVerified,
    });

    const status = await signedIn.mutation(getStatus, {});
    expect(status.body).toMatchObject(
      complimentary
        ? {
            access: "complimentary",
            isAuthorized: true,
            hasFullAppAccess: true,
            requiresSubscription: false,
            subscriptionStatus: "active",
          }
        : { access: "trial", hasFullAppAccess: false, subscriptionStatus: "none" },
    );
  });

  test.each([
    {
      label: "Clerk user id",
      env: "CLERK_COMPLIMENTARY_USER_IDS",
      value: "user_explicit_access,user_someone_else",
      subject: "user_explicit_access",
      email: "ordinary@example.com",
    },
    {
      label: "verified email",
      env: "CLERK_COMPLIMENTARY_EMAILS",
      value: "vip@example.com,other@example.com",
      subject: "user_email_access",
      email: "VIP@example.com",
    },
  ])("grants configurable complimentary access by $label", async ({ env, value, subject, email }) => {
    vi.stubEnv(env, value);
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({
      subject,
      tokenIdentifier: `clerk|${subject}`,
      email,
      email_verified: true,
    });

    expect((await signedIn.mutation(getStatus, {})).body).toMatchObject({
      access: "complimentary",
      hasFullAppAccess: true,
      subscriptionStatus: "active",
    });

    vi.stubEnv(env, "");
    expect((await signedIn.mutation(getStatus, {})).body).toMatchObject({
      access: "trial",
      hasFullAppAccess: false,
      subscriptionStatus: "none",
    });
  });

  test("grants unlimited complimentary access to the configured Clerk organization", async () => {
    vi.stubEnv("CLERK_COMPLIMENTARY_ORGANIZATION_ID", "org_volt_workplace");
    const t = convexTest(schema, modules);
    const workUser = t.withIdentity({
      subject: "user_work",
      tokenIdentifier: "clerk|user_work",
      org_id: "org_volt_workplace",
      org_name: "Volt Workplace",
    });
    const status = await workUser.mutation(getStatus, {});
    expect(status.body).toMatchObject({
      access: "complimentary",
      isAuthorized: true,
      hasFullAppAccess: true,
      organizationId: "org_volt_workplace",
      freeSessionsRemaining: 5,
      requiresSubscription: false,
    });
    const entitlement = await t.run((ctx) =>
      ctx.db
        .query("organizationEntitlements")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", "org_volt_workplace"),
        )
        .unique(),
    );
    expect(entitlement).toMatchObject({ status: "active", source: "complimentary" });

    const workSessionReady = makeFunctionReference<
      "mutation",
      {
        clerkUserId: string;
        tokenIdentifier: string;
        organizationId: string;
        token: string;
      },
      SessionResult
    >("access:sessionReadyForHttp");
    for (let sequence = 1; sequence <= 7; sequence += 1) {
      const token = `work-join-${sequence}-abcdefghijklmnopqrstuvwxyz`;
      await t.mutation(internal.scannerSignal.joinTokens.createJoinToken, {
        token,
        sessionId: `work-browser-${sequence}`,
        usageSessionId: `work-usage-${sequence}`,
        clerkUserId: "user_work",
        origin: "https://example.test",
      });
      const ready = await t.mutation(workSessionReady, {
        clerkUserId: "user_work",
        tokenIdentifier: "clerk|user_work",
        organizationId: "org_volt_workplace",
        token,
      });
      expect(ready).toMatchObject({
        statusCode: 200,
        body: {
          consumed: false,
          status: { access: "complimentary", freeSessionsRemaining: 5 },
        },
      });
    }
  });

  test.each([
    { label: "active", expiresOffset: 60_000, expected: "active", access: "subscription" },
    { label: "expired", expiresOffset: -60_000, expected: "expired", access: "trial" },
  ])("reflects $label StoreKit entitlements", async ({ expiresOffset, expected, access }) => {
    vi.useFakeTimers();
    const now = new Date("2026-07-10T12:00:00Z").getTime();
    vi.setSystemTime(now);
    const t = convexTest(schema, modules);
    const clerkUserId = `user_storekit_${expected}`;
    const signedIn = t.withIdentity({ subject: clerkUserId });
    const initial = await signedIn.mutation(getStatus, {});
    const appAccountToken = initial.body.appAccountToken as string;

    const applied = await t.mutation(applyTransaction, {
      transactionId: `transaction_${expected}`,
      originalTransactionId: `original_${expected}`,
      appAccountToken,
      productId: "com.volt.mobile.pro.monthly",
      environment: "Sandbox",
      purchaseDate: now - 60_000,
      expiresDate: now + expiresOffset,
      signedDate: now,
      source: "client",
      expectedClerkUserId: clerkUserId,
    });
    expect(applied.statusCode).toBe(200);
    const status = await signedIn.mutation(getStatus, {});
    expect(status.body).toMatchObject({
      subscriptionStatus: expected,
      access,
      hasFullAppAccess: expected === "active",
    });
  });

  test("does not let an older valid transaction replay erase a newer revocation", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-10T12:00:00Z").getTime();
    vi.setSystemTime(now);
    const t = convexTest(schema, modules);
    const clerkUserId = "user_storekit_replay";
    const signedIn = t.withIdentity({ subject: clerkUserId });
    const initialStatus = await signedIn.mutation(getStatus, {});
    const appAccountToken = initialStatus.body.appAccountToken as string;
    const transaction = {
      transactionId: "transaction_replay",
      originalTransactionId: "original_replay",
      appAccountToken,
      productId: "com.volt.mobile.pro.monthly",
      environment: "Sandbox",
      purchaseDate: now - 60_000,
      expiresDate: now + 60_000,
      expectedClerkUserId: clerkUserId,
    };

    await t.mutation(applyTransaction, {
      ...transaction,
      signedDate: now,
      source: "client",
    });
    const revoked = await t.mutation(applyTransaction, {
      ...transaction,
      signedDate: now + 2_000,
      revocationDate: now + 1_000,
      source: "notification",
      notification: {
        notificationUUID: "notification_revoked",
        notificationType: "REVOKE",
        signedDate: now + 2_000,
      },
    });
    expect(revoked.body).toMatchObject({ accepted: true, subscriptionStatus: "expired" });

    const replay = await t.mutation(applyTransaction, {
      ...transaction,
      signedDate: now + 1_000,
      source: "client",
    });
    expect(replay.body).toMatchObject({
      accepted: true,
      idempotent: true,
      stale: true,
      subscriptionStatus: "expired",
    });
    const staleNotification = await t.mutation(applyTransaction, {
      ...transaction,
      signedDate: now + 1_000,
      source: "notification",
      notification: {
        notificationUUID: "notification_stale_replay",
        notificationType: "DID_RENEW",
        signedDate: now + 3_000,
      },
    });
    expect(staleNotification.body).toMatchObject({ accepted: true, stale: true });

    const stored = await t.run((ctx) =>
      ctx.db
        .query("storeKitTransactions")
        .withIndex("by_transactionId", (query) => query.eq("transactionId", transaction.transactionId))
        .unique(),
    );
    expect(stored).toMatchObject({
      signedDate: now + 2_000,
      revocationDate: now + 1_000,
      expiresDate: now + 60_000,
    });
    const notification = await t.run((ctx) =>
      ctx.db
        .query("storeKitNotifications")
        .withIndex("by_notificationUUID", (query) =>
          query.eq("notificationUUID", "notification_stale_replay"),
        )
        .unique(),
    );
    expect(notification).toMatchObject({ transactionId: transaction.transactionId });
    expect((await signedIn.mutation(getStatus, {})).body).toMatchObject({
      subscriptionStatus: "expired",
      access: "trial",
    });
  });

  test("an update to an older renewal does not override a later active renewal", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-10T12:00:00Z").getTime();
    vi.setSystemTime(now);
    const t = convexTest(schema, modules);
    const clerkUserId = "user_storekit_renewal_order";
    const signedIn = t.withIdentity({ subject: clerkUserId });
    const initial = await signedIn.mutation(getStatus, {});
    const appAccountToken = initial.body.appAccountToken as string;
    const shared = {
      originalTransactionId: "original_renewal_order",
      appAccountToken,
      productId: "com.volt.mobile.pro.monthly",
      environment: "Sandbox",
      source: "notification" as const,
    };

    await t.mutation(applyTransaction, {
      ...shared,
      transactionId: "transaction_older_period",
      purchaseDate: now - 120_000,
      expiresDate: now + 60_000,
      signedDate: now,
    });
    await t.mutation(applyTransaction, {
      ...shared,
      transactionId: "transaction_current_period",
      purchaseDate: now - 60_000,
      expiresDate: now + 120_000,
      signedDate: now + 1,
    });
    await t.mutation(applyTransaction, {
      ...shared,
      transactionId: "transaction_older_period",
      purchaseDate: now - 120_000,
      expiresDate: now + 60_000,
      signedDate: now + 2,
      revocationDate: now + 2,
    });

    expect((await signedIn.mutation(getStatus, {})).body).toMatchObject({
      access: "subscription",
      subscriptionStatus: "active",
      expiresAt: now + 120_000,
    });
  });
});

const adminOverview = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    isAdmin: boolean;
    accounts: Array<{ clerkUserId: string; email: string | null; hasProAccess: boolean; isComped: boolean }>;
    grants: Array<{ id: string; email: string | null; status: string }>;
  }
>("admin:overview");
const adminGrantPro = makeFunctionReference<
  "mutation",
  { clerkUserId?: string; email?: string; note?: string },
  { ok: true }
>("admin:grantPro");
const adminRevokePro = makeFunctionReference<"mutation", { grantId: string }, { ok: true }>(
  "admin:revokePro",
);

describe("admin comped Pro access", () => {
  const admin = { subject: "user_admin", tokenIdentifier: "clerk|user_admin", email: "juanquenga@gmail.com" };

  test("only an admin identity can read the console or hand out Pro", async () => {
    const t = convexTest(schema, modules);
    const stranger = t.withIdentity({ subject: "user_stranger", tokenIdentifier: "clerk|user_stranger", email: "someone@example.com" });

    expect(await stranger.query(adminOverview, {})).toMatchObject({ isAdmin: false });
    await expect(stranger.mutation(adminGrantPro, { email: "friend@example.com" })).rejects.toThrow();
    expect(await t.withIdentity(admin).query(adminOverview, {})).toMatchObject({ isAdmin: true });
  });

  test("comps an email before that person signs in, then takes it back", async () => {
    const t = convexTest(schema, modules);
    const adminSession = t.withIdentity(admin);
    await adminSession.mutation(adminGrantPro, { email: "Friend@Example.com", note: "beta tester" });

    const friend = t.withIdentity({
      subject: "user_friend",
      tokenIdentifier: "clerk|user_friend",
      email: "friend@example.com",
    });
    expect((await friend.mutation(getStatus, {})).body).toMatchObject({
      access: "complimentary",
      hasFullAppAccess: true,
      subscriptionStatus: "active",
    });

    const overview = await adminSession.query(adminOverview, {});
    expect(overview.accounts.find((account) => account.clerkUserId === "user_friend")).toMatchObject({
      hasProAccess: true,
      isComped: true,
    });

    const grant = overview.grants.find((entry) => entry.email === "friend@example.com");
    expect(grant?.status).toBe("active");
    await adminSession.mutation(adminRevokePro, { grantId: grant!.id });

    expect((await friend.mutation(getStatus, {})).body).toMatchObject({
      access: "trial",
      hasFullAppAccess: false,
      subscriptionStatus: "none",
    });
  });
});
