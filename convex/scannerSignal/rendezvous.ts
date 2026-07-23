import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { makeFunctionReference } from "convex/server";
import { buildScannerAppClipJoinUrl } from "@volt/scanner-protocol";
import type { ClerkAuthContext, AccessStatus } from "../access";
import {
  makeSecretId,
  normalizePushSubscription,
  numberFrom,
  stringArrayFrom,
  stringFrom,
  type NormalizedPushSubscription,
  type SignalRequestBody,
} from "./httpAdapter";
import {
  logScannerSignalEvent,
  scannerSignalIdTail,
  scannerSignalRouteTemplate,
} from "./logging";
import type { SignalRouteCommand } from "./routeCommands";

export type ScannerSignalRendezvousResult = {
  statusCode: number;
  body: unknown;
};

export type ScannerSignalRendezvousRequest = {
  command: SignalRouteCommand;
  parts: string[];
  body: SignalRequestBody;
  origin: string;
  startedAt: number;
  browserClaim?: string;
  pairingSecret?: string;
  pendingReconnectBrowserSessionId?: string;
  auth: ClerkAuthContext;
  anonymousId?: string;
  anonymousSecret?: string;
};

type AccessMutationArgs = ClerkAuthContext & {
  anonymousId?: string;
  anonymousSecret?: string;
};

type JoinAuthorizationArgs = AccessMutationArgs & { usageSessionId: string };

type AccessMutationResult = {
  statusCode: number;
  body: AccessStatus | { error: string } | Record<string, unknown>;
  owner?: { clerkUserId?: string; anonymousId?: string };
};

const authorizeJoinToken = makeFunctionReference<
  "mutation",
  JoinAuthorizationArgs,
  AccessMutationResult
>("access:authorizeJoinToken");

const sessionReady = makeFunctionReference<
  "mutation",
  AccessMutationArgs & { token: string; usageSessionId?: string },
  AccessMutationResult
>("access:sessionReadyForHttp");

const createGuestGrant = makeFunctionReference<
  "mutation",
  { clerkUserId: string; joinToken: string; usageSessionId: string },
  { guestCloudGrant: string; expiresAt: number }
>("cloudWorkspace:createGuestGrant");

function accessArgs(request: ScannerSignalRendezvousRequest): AccessMutationArgs {
  return {
    ...request.auth,
    ...(request.anonymousId ? { anonymousId: request.anonymousId } : {}),
    ...(request.anonymousSecret ? { anonymousSecret: request.anonymousSecret } : {}),
  };
}

function scannerSignalResult(body: unknown, statusCode = 200): ScannerSignalRendezvousResult {
  return { statusCode, body };
}

function missingField(message: string): ScannerSignalRendezvousResult {
  return scannerSignalResult({ error: message }, 400);
}

async function createReconnectRequest(
  ctx: ActionCtx,
  request: ScannerSignalRendezvousRequest,
): Promise<ScannerSignalRendezvousResult> {
  const pairingId = request.parts[1];
  const result = await ctx.runMutation(internal.scannerSignal.reconnectRequests.createReconnectRequest, {
    pairingId,
    pairingSecret: request.pairingSecret,
    requestId: makeSecretId(18),
  });
  if (result.statusCode !== 200) return result;

  const responseBody = result.body as {
    request?: { id?: string };
    pushSubscription?: NormalizedPushSubscription | null;
  };
  const requestId = typeof responseBody.request?.id === "string" ? responseBody.request.id : "";
  await ctx.scheduler.runAfter(0, internal.scannerPush.sendReconnectWakePush, {
    subscription: responseBody.pushSubscription ?? null,
    pairingId,
    requestId,
  }).catch(() => {
    logScannerSignalEvent(
      "push_wake_failed",
      {
        route: scannerSignalRouteTemplate(request.command),
        command: request.command,
        statusCode: result.statusCode,
        elapsedMs: Date.now() - request.startedAt,
        pairingIdTail: scannerSignalIdTail(pairingId),
        requestIdTail: scannerSignalIdTail(requestId),
        reason: "schedule_rejected",
      },
      "warn",
    );
    return { sent: false };
  });

  const { pushSubscription: _pushSubscription, ...bodyWithoutSubscription } = responseBody;
  return scannerSignalResult(bodyWithoutSubscription, result.statusCode);
}

export async function executeScannerSignalRendezvous(
  ctx: ActionCtx,
  request: ScannerSignalRendezvousRequest,
): Promise<ScannerSignalRendezvousResult> {
  const { command, parts, body, origin } = request;

  if (command === "createJoinToken") {
    const usageSessionId = stringFrom(body.usageSessionId, 120);
    if (!usageSessionId) return missingField("Missing usageSessionId");
    const authorization = await ctx.runMutation(authorizeJoinToken, {
      ...accessArgs(request),
      usageSessionId,
    });
    if (authorization.statusCode !== 200) return authorization;
    const sessionId = stringFrom(body.sessionId, 120) ?? makeSecretId(12);
    const token = makeSecretId();
    const deviceLabel = stringFrom(body.deviceLabel, 120);
    const response = await ctx.runMutation(internal.scannerSignal.joinTokens.createJoinToken, {
      token,
      sessionId,
      browserClaim: stringFrom(body.browserClaim, 240),
      ttlMs: numberFrom(body.ttlMs),
      graceMs: numberFrom(body.graceMs),
      origin,
      usageSessionId,
      anonymousId: authorization.owner?.anonymousId,
      clerkUserId: authorization.owner?.clerkUserId,
    });
    const guestCloud = authorization.owner?.clerkUserId
      ? await ctx.runMutation(createGuestGrant, {
          clerkUserId: authorization.owner.clerkUserId,
          joinToken: response.token,
          usageSessionId,
        })
      : undefined;
    return scannerSignalResult({
      ...response,
      qrCodeUrl: buildScannerAppClipJoinUrl({
        token: response.token,
        sessionId: response.sessionId,
        label: deviceLabel,
        signalUrl: `${origin}/api/signal`,
        guestCloudGrant: guestCloud?.guestCloudGrant,
        guestCloudExpiresAt: guestCloud?.expiresAt,
      }),
    });
  }

  if (parts[0] === "join-token" && parts.length >= 2) {
    const token = parts[1];
    if (command === "sessionReady") {
      return ctx.runMutation(sessionReady, {
        ...accessArgs(request),
        token,
        usageSessionId: stringFrom(body.usageSessionId, 120),
      });
    }
    if (command === "getJoinTokenStatus") {
      return ctx.runMutation(internal.scannerSignal.joinTokens.getJoinTokenStatus, { token });
    }
    if (command === "revokeJoinToken") {
      return ctx.runMutation(internal.scannerSignal.joinTokens.revokeJoinToken, {
        token,
        browserClaim: request.browserClaim,
      });
    }
    if (command === "rotateJoinToken") {
      return ctx.runMutation(internal.scannerSignal.joinTokens.rotateJoinToken, {
        token,
        nextToken: makeSecretId(),
        browserClaim: request.browserClaim,
        ttlMs: numberFrom(body.ttlMs),
        graceMs: numberFrom(body.graceMs),
        origin,
      });
    }
    if (command === "listJoinAttempts") {
      return ctx.runMutation(internal.scannerSignal.joinAttempts.listJoinAttempts, {
        token,
        browserClaim: request.browserClaim,
      });
    }
    if (command === "createJoinAttempt") {
      return ctx.runMutation(internal.scannerSignal.joinAttempts.createJoinAttempt, {
        token,
        attemptId: makeSecretId(18),
        contributorId: stringFrom(body.contributorId, 120),
        deviceLabel: stringFrom(body.deviceLabel, 120),
        protocolVersion: stringFrom(body.protocolVersion, 80),
        capabilities: stringArrayFrom(body.capabilities),
        attemptTtlMs: numberFrom(body.attemptTtlMs),
      });
    }
    if (parts[2] === "attempt" && parts.length === 5) {
      const attemptId = parts[3];
      if (command === "postJoinOffer") {
        const offer = stringFrom(body.offer, 200_000);
        if (!offer) return missingField("Missing offer");
        return ctx.runMutation(internal.scannerSignal.joinAttempts.postJoinOffer, {
          token,
          attemptId,
          browserClaim: request.browserClaim,
          offer,
        });
      }
      if (command === "getJoinOffer") {
        return ctx.runMutation(internal.scannerSignal.joinAttempts.getJoinOffer, { token, attemptId });
      }
      if (command === "postJoinAnswer") {
        const answer = stringFrom(body.answer, 200_000);
        if (!answer) return missingField("Missing answer");
        return ctx.runMutation(internal.scannerSignal.joinAttempts.postJoinAnswer, { token, attemptId, answer });
      }
      if (command === "getJoinAnswer") {
        return ctx.runMutation(internal.scannerSignal.joinAttempts.getJoinAnswer, {
          token,
          attemptId,
          browserClaim: request.browserClaim,
        });
      }
    }
  }

  if (parts[0] === "pairings") {
    if (command === "registerPairing") {
      return ctx.runMutation(internal.scannerSignal.pairings.registerPairing, {
        pairingId: stringFrom(body.pairingId, 120) ?? makeSecretId(18),
        pairingSecret: stringFrom(body.pairingSecret, 240) ?? makeSecretId(32),
        browserSessionId: stringFrom(body.browserSessionId ?? body.sessionId, 120) ?? "",
        displayName: stringFrom(body.displayName, 120),
        phoneDeviceId: stringFrom(body.phoneDeviceId, 120),
        phoneLabel: stringFrom(body.phoneLabel, 120),
        pushSubscription: normalizePushSubscription(body.pushSubscription),
      });
    }
    if (command === "getPendingReconnectRequests") {
      return ctx.runMutation(internal.scannerSignal.reconnectRequests.getPendingReconnectRequests, {
        browserSessionId: request.pendingReconnectBrowserSessionId ?? "",
      });
    }
    const pairingId = parts[1];
    if (command === "createReconnectRequest") {
      return createReconnectRequest(ctx, request);
    }
    if (command === "getReconnectRequestStatus") {
      return ctx.runMutation(internal.scannerSignal.reconnectRequests.getReconnectRequestStatus, {
        pairingId,
        requestId: parts[3],
        pairingSecret: request.pairingSecret,
      });
    }
    if (command === "postReconnectJoinWindow") {
      const joinUrl = stringFrom(body.joinUrl, 1000);
      const joinToken = stringFrom(body.joinToken, 240);
      const sessionId = stringFrom(body.sessionId, 120);
      if (!joinUrl || !joinToken || !sessionId) return missingField("Invalid join window");
      return ctx.runMutation(internal.scannerSignal.reconnectRequests.postReconnectJoinWindow, {
        pairingId,
        requestId: parts[3],
        answeringPairingId: stringFrom(body.answeringPairingId, 120),
        pairingSecret: request.pairingSecret,
        joinUrl,
        joinToken,
        sessionId,
      });
    }
  }

  return scannerSignalResult({ error: "Not found" }, 404);
}
