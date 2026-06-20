import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

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

function makeSecretId(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function partsFromRequest(request: Request) {
  const url = new URL(request.url);
  return url.pathname.replace(/^\/api\/signal\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

async function bodyFromRequest(request: Request) {
  if (request.method === "GET" || request.method === "OPTIONS") return {};
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch (_error) {
    return {};
  }
}

function stringFrom(value: unknown, maxLength = 4000) {
  return typeof value === "string" && value ? value.slice(0, maxLength) : undefined;
}

function stringArrayFrom(value: unknown, maxItems = 20, maxLength = 80) {
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .map((item) => item.slice(0, maxLength))
    .slice(0, maxItems);
  return strings.length ? strings : undefined;
}

function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function browserClaimFrom(request: Request, body: Record<string, unknown>) {
  return request.headers.get("X-Volt-Browser-Claim") ?? stringFrom(body.browserClaim, 240);
}

function pairingSecretFrom(request: Request, body: Record<string, unknown>) {
  return request.headers.get("X-Volt-Pairing-Secret") ?? stringFrom(body.pairingSecret, 240);
}

function normalizePushSubscription(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: { auth?: unknown; p256dh?: unknown };
  };
  if (typeof raw.endpoint !== "string" || !raw.endpoint) return undefined;
  if (!raw.keys || typeof raw.keys.auth !== "string" || typeof raw.keys.p256dh !== "string") return undefined;
  return {
    endpoint: raw.endpoint,
    ...(typeof raw.expirationTime === "number" || raw.expirationTime === null ? { expirationTime: raw.expirationTime } : {}),
    keys: {
      auth: raw.keys.auth,
      p256dh: raw.keys.p256dh,
    },
  };
}

async function runAndRespond<T extends { statusCode: number; body: unknown }>(result: Promise<T>) {
  const response = await result;
  return jsonResponse(response.body, response.statusCode);
}

const signalHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();

  const url = new URL(request.url);
  const parts = partsFromRequest(request);
  const body = await bodyFromRequest(request);

  if (request.method === "POST" && parts.length === 1 && parts[0] === "join-token") {
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
    if (request.method === "GET" && parts.length === 2) {
      return runAndRespond(ctx.runMutation(internal.scannerSignal.joinTokens.getJoinTokenStatus, { token }));
    }
    if (request.method === "POST" && parts[2] === "revoke" && parts.length === 3) {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.joinTokens.revokeJoinToken, {
          token,
          browserClaim: browserClaimFrom(request, body),
        }),
      );
    }
    if (request.method === "POST" && parts[2] === "rotate" && parts.length === 3) {
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
    if (request.method === "GET" && parts[2] === "attempts" && parts.length === 3) {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.joinAttempts.listJoinAttempts, {
          token,
          browserClaim: browserClaimFrom(request, body),
        }),
      );
    }
    if (request.method === "POST" && parts[2] === "attempt" && parts.length === 3) {
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
      const route = parts[4];
      if (route === "offer" && request.method === "POST") {
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
      if (route === "offer" && request.method === "GET") {
        return runAndRespond(ctx.runMutation(internal.scannerSignal.joinAttempts.getJoinOffer, { token, attemptId }));
      }
      if (route === "answer" && request.method === "POST") {
        const answer = stringFrom(body.answer, 200_000);
        if (!answer) return jsonResponse({ error: "Missing answer" }, 400);
        return runAndRespond(ctx.runMutation(internal.scannerSignal.joinAttempts.postJoinAnswer, { token, attemptId, answer }));
      }
      if (route === "answer" && request.method === "GET") {
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
    if (request.method === "POST" && parts.length === 1) {
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
    if (request.method === "GET" && parts[1] === "reconnect-requests" && parts.length === 2) {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.reconnectRequests.getPendingReconnectRequests, {
          browserSessionId: stringFrom(url.searchParams.get("sessionId"), 120) ?? "",
        }),
      );
    }
    const pairingId = parts[1];
    if (request.method === "POST" && parts[2] === "reconnect" && parts.length === 3) {
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
    if (parts[2] === "reconnect" && parts.length === 4 && request.method === "GET") {
      return runAndRespond(
        ctx.runMutation(internal.scannerSignal.reconnectRequests.getReconnectRequestStatus, {
          pairingId,
          requestId: parts[3],
          pairingSecret: pairingSecretFrom(request, body),
        }),
      );
    }
    if (parts[2] === "reconnect" && parts[4] === "join-window" && parts.length === 5 && request.method === "POST") {
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

  if (parts[0] === "push" && parts[1] === "public-key" && request.method === "GET" && parts.length === 2) {
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
