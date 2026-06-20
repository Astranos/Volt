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
  signalBodyFromRequest,
  signalPartsFromRequest,
  stringArrayFrom,
  stringFrom,
} from "./scannerSignal/httpAdapter";
import { signalRouteCommand } from "./scannerSignal/routeCommands";

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

async function runAndRespond<T extends { statusCode: number; body: unknown }>(result: Promise<T>) {
  const response = await result;
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
    return jsonResponse(response);
  }

  if (parts[0] === "join-token" && parts.length >= 2) {
    const token = parts[1];
    if (command === "getJoinTokenStatus") {
      return runAndRespond(ctx.runMutation(internal.scannerSignal.joinTokens.getJoinTokenStatus, { token }));
    }
    if (command === "revokeJoinToken") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.joinTokens.revokeJoinToken, {
          token,
          browserClaim: browserClaimFrom(request, body),
        }),
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
      );
    }
    if (command === "listJoinAttempts") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.joinAttempts.listJoinAttempts, {
          token,
          browserClaim: browserClaimFrom(request, body),
        }),
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
      );
    }
    if (parts[2] === "attempt" && parts.length === 5) {
      const attemptId = parts[3];
      if (command === "postJoinOffer") {
        const offer = stringFrom(body.offer, 200_000);
        if (!offer) return jsonResponse({ error: "Missing offer" }, 400);
        return runAndRespond(
          ctx.runMutation(internal.scannerSignal.joinAttempts.postJoinOffer, {
            token,
            attemptId,
            browserClaim: browserClaimFrom(request, body),
            offer,
          }),
        );
      }
      if (command === "getJoinOffer") {
        return runAndRespond(ctx.runMutation(internal.scannerSignal.joinAttempts.getJoinOffer, { token, attemptId }));
      }
      if (command === "postJoinAnswer") {
        const answer = stringFrom(body.answer, 200_000);
        if (!answer) return jsonResponse({ error: "Missing answer" }, 400);
        return runAndRespond(ctx.runMutation(internal.scannerSignal.joinAttempts.postJoinAnswer, { token, attemptId, answer }));
      }
      if (command === "getJoinAnswer") {
        return runAndRespond(
          ctx.runMutation(internal.scannerSignal.joinAttempts.getJoinAnswer, {
            token,
            attemptId,
            browserClaim: browserClaimFrom(request, body),
          }),
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
      );
    }
    if (command === "getPendingReconnectRequests") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.reconnectRequests.getPendingReconnectRequests, {
          browserSessionId: stringFrom(url.searchParams.get("sessionId"), 120) ?? "",
        }),
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
        });
        const { pushSubscription: _pushSubscription, ...bodyWithoutSubscription } = responseBody;
        return jsonResponse(bodyWithoutSubscription, result.statusCode);
      }
      return jsonResponse(result.body, result.statusCode);
    }
    if (command === "getReconnectRequestStatus") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.reconnectRequests.getReconnectRequestStatus, {
          pairingId,
          requestId: parts[3],
          pairingSecret: pairingSecretFrom(request, body),
        }),
      );
    }
    if (command === "postReconnectJoinWindow") {
      const joinUrl = stringFrom(body.joinUrl, 1000);
      const joinToken = stringFrom(body.joinToken, 240);
      const sessionId = stringFrom(body.sessionId, 120);
      if (!joinUrl || !joinToken || !sessionId) return jsonResponse({ error: "Invalid join window" }, 400);
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.reconnectRequests.postReconnectJoinWindow, {
          pairingId,
          requestId: parts[3],
          pairingSecret: pairingSecretFrom(request, body),
          joinUrl,
          joinToken,
          sessionId,
        }),
      );
    }
  }

  if (command === "getPushPublicKey") {
    const publicKey = process.env.SCANNER_PUSH_VAPID_PUBLIC_KEY;
    if (!publicKey) return jsonResponse({ error: "Web Push is not configured" }, 404);
    return jsonResponse({ publicKey });
  }

  return jsonResponse({ error: "Not found" }, 404);
});

http.route({ path: "/api/signal", method: "GET", handler: signalHandler });
http.route({ path: "/api/signal", method: "POST", handler: signalHandler });
http.route({ path: "/api/signal", method: "OPTIONS", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "GET", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "POST", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "OPTIONS", handler: signalHandler });

export default http;
