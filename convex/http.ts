import { httpRouter } from "convex/server";
import {
  SCANNER_STUN_ONLY_ICE_SERVERS,
  buildScannerIceServersResponse,
  normalizeScannerIceServers,
  scannerStunOnlyIceServersResponse,
} from "@volt/scanner-protocol";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  browserClaimFrom,
  makeSecretId,
  normalizePushSubscription,
  numberFrom,
  pairingSecretFrom,
  type SignalRequestBody,
  signalBodyFromRequest,
  signalPartsFromRequest,
  stringArrayFrom,
  stringFrom,
} from "./scannerSignal/httpAdapter";
import {
  logScannerSignalEvent,
  scannerSignalEventForCommand,
  scannerSignalIdTail,
  scannerSignalRouteTemplate,
  type ScannerSignalLogFields,
} from "./scannerSignal/logging";
import { signalRouteCommand } from "./scannerSignal/routeCommands";
import type { SignalRouteCommand } from "./scannerSignal/routeCommands";

const http = httpRouter();
const CLOUDFLARE_TURN_GENERATE_ICE_SERVERS_BASE_URL = "https://rtc.live.cloudflare.com/v1/turn/keys";
const DEFAULT_CLOUDFLARE_TURN_TTL_SECONDS = 86_400;
const STUN_FALLBACK_TTL_SECONDS = 300;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Volt-Browser-Claim, X-Volt-Pairing-Secret",
  "Cache-Control": "no-store",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

function signalJsonResponse(
  command: SignalRouteCommand,
  parts: string[],
  requestBody: SignalRequestBody,
  responseBody: unknown,
  statusCode: number,
  startedAt: number,
) {
  logScannerSignalResponse(command, parts, requestBody, responseBody, statusCode, startedAt);
  return jsonResponse(responseBody, statusCode);
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

  if (command === "createJoinToken") {
    const sessionId = stringFrom(body.sessionId, 120) ?? makeSecretId(12);
    const token = makeSecretId();
    const response = await ctx.runMutation(internal.scannerSignal.joinTokens.createJoinToken, {
      token,
      sessionId,
      browserClaim: stringFrom(body.browserClaim, 240),
      ttlMs: numberFrom(body.ttlMs),
      graceMs: numberFrom(body.graceMs),
      origin: url.origin,
    });
    return signalJsonResponse(command, parts, body, response, 200, startedAt);
  }

  if (parts[0] === "join-token" && parts.length >= 2) {
    const token = parts[1];
    if (command === "getJoinTokenStatus") {
      return runAndRespond(ctx.runMutation(internal.scannerSignal.joinTokens.getJoinTokenStatus, { token }), logContext);
    }
    if (command === "revokeJoinToken") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.joinTokens.revokeJoinToken, {
          token,
          browserClaim: browserClaimFrom(request, body),
        }),
        logContext,
      );
    }
    if (command === "rotateJoinToken") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.joinTokens.rotateJoinToken, {
          token,
          nextToken: makeSecretId(),
          browserClaim: browserClaimFrom(request, body),
          ttlMs: numberFrom(body.ttlMs),
          graceMs: numberFrom(body.graceMs),
          origin: url.origin,
        }),
        logContext,
      );
    }
    if (command === "listJoinAttempts") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.joinAttempts.listJoinAttempts, {
          token,
          browserClaim: browserClaimFrom(request, body),
        }),
        logContext,
      );
    }
    if (command === "createJoinAttempt") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.joinAttempts.createJoinAttempt, {
          token,
          attemptId: makeSecretId(18),
          contributorId: stringFrom(body.contributorId, 120),
          deviceLabel: stringFrom(body.deviceLabel, 120),
          protocolVersion: stringFrom(body.protocolVersion, 80),
          capabilities: stringArrayFrom(body.capabilities),
          attemptTtlMs: numberFrom(body.attemptTtlMs),
        }),
        logContext,
      );
    }
    if (parts[2] === "attempt" && parts.length === 5) {
      const attemptId = parts[3];
      if (command === "postJoinOffer") {
        const offer = stringFrom(body.offer, 200_000);
        if (!offer) return signalJsonResponse(command, parts, body, { error: "Missing offer" }, 400, startedAt);
        return runAndRespond(
          ctx.runMutation(internal.scannerSignal.joinAttempts.postJoinOffer, {
            token,
            attemptId,
            browserClaim: browserClaimFrom(request, body),
            offer,
          }),
          logContext,
        );
      }
      if (command === "getJoinOffer") {
        return runAndRespond(ctx.runMutation(internal.scannerSignal.joinAttempts.getJoinOffer, { token, attemptId }), logContext);
      }
      if (command === "postJoinAnswer") {
        const answer = stringFrom(body.answer, 200_000);
        if (!answer) return signalJsonResponse(command, parts, body, { error: "Missing answer" }, 400, startedAt);
        return runAndRespond(
          ctx.runMutation(internal.scannerSignal.joinAttempts.postJoinAnswer, { token, attemptId, answer }),
          logContext,
        );
      }
      if (command === "getJoinAnswer") {
        return runAndRespond(
          ctx.runMutation(internal.scannerSignal.joinAttempts.getJoinAnswer, {
            token,
            attemptId,
            browserClaim: browserClaimFrom(request, body),
          }),
          logContext,
        );
      }
    }
  }

  if (parts[0] === "pairings") {
    if (command === "registerPairing") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.pairings.registerPairing, {
          pairingId: stringFrom(body.pairingId, 120) ?? makeSecretId(18),
          pairingSecret: stringFrom(body.pairingSecret, 240) ?? makeSecretId(32),
          browserSessionId: stringFrom(body.browserSessionId ?? body.sessionId, 120) ?? "",
          displayName: stringFrom(body.displayName, 120),
          phoneDeviceId: stringFrom(body.phoneDeviceId, 120),
          phoneLabel: stringFrom(body.phoneLabel, 120),
          pushSubscription: normalizePushSubscription(body.pushSubscription),
        }),
        logContext,
      );
    }
    if (command === "getPendingReconnectRequests") {
      const browserSessionId = stringFrom(url.searchParams.get("sessionId"), 120) ?? "";
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.reconnectRequests.getPendingReconnectRequests, {
          browserSessionId,
        }),
        { ...logContext, requestBody: { browserSessionId } },
      );
    }
    const pairingId = parts[1];
    if (command === "createReconnectRequest") {
      const result = await ctx.runMutation(internal.scannerSignal.reconnectRequests.createReconnectRequest, {
        pairingId,
        pairingSecret: pairingSecretFrom(request, body),
        requestId: makeSecretId(18),
      });
      if (result.statusCode === 200) {
        const responseBody = result.body as {
          request?: { id?: string };
          pushSubscription?: Parameters<typeof normalizePushSubscription>[0] | null;
        };
        const requestId = typeof responseBody.request?.id === "string" ? responseBody.request.id : "";
        await ctx.runAction(internal.scannerPush.sendReconnectWakePush, {
          subscription: responseBody.pushSubscription ?? null,
          pairingId,
          requestId,
        }).catch(() => {
          logScannerSignalEvent(
            "push_wake_failed",
            {
              route: scannerSignalRouteTemplate(command),
              command,
              statusCode: result.statusCode,
              elapsedMs: Date.now() - startedAt,
              pairingIdTail: scannerSignalIdTail(pairingId),
              requestIdTail: scannerSignalIdTail(requestId),
              reason: "action_rejected",
            },
            "warn",
          );
          return { sent: false };
        });
        const { pushSubscription: _pushSubscription, ...bodyWithoutSubscription } = responseBody;
        return signalJsonResponse(command, parts, body, bodyWithoutSubscription, result.statusCode, startedAt);
      }
      return signalJsonResponse(command, parts, body, result.body, result.statusCode, startedAt);
    }
    if (command === "getReconnectRequestStatus") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.reconnectRequests.getReconnectRequestStatus, {
          pairingId,
          requestId: parts[3],
          pairingSecret: pairingSecretFrom(request, body),
        }),
        logContext,
      );
    }
    if (command === "postReconnectJoinWindow") {
      const joinUrl = stringFrom(body.joinUrl, 1000);
      const joinToken = stringFrom(body.joinToken, 240);
      const sessionId = stringFrom(body.sessionId, 120);
      if (!joinUrl || !joinToken || !sessionId) {
        return signalJsonResponse(command, parts, body, { error: "Invalid join window" }, 400, startedAt);
      }
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.reconnectRequests.postReconnectJoinWindow, {
          pairingId,
          requestId: parts[3],
          pairingSecret: pairingSecretFrom(request, body),
          joinUrl,
          joinToken,
          sessionId,
        }),
        logContext,
      );
    }
  }

  if (command === "getPushPublicKey") {
    const publicKey = process.env.SCANNER_PUSH_VAPID_PUBLIC_KEY;
    if (!publicKey) return jsonResponse({ error: "Web Push is not configured" }, 404);
    return jsonResponse({ publicKey });
  }

  return signalJsonResponse(command, parts, body, { error: "Not found" }, 404, startedAt);
});

http.route({ path: "/api/signal", method: "GET", handler: signalHandler });
http.route({ path: "/api/signal", method: "POST", handler: signalHandler });
http.route({ path: "/api/signal", method: "OPTIONS", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "GET", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "POST", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "OPTIONS", handler: signalHandler });

export default http;
