import { httpRouter } from "convex/server";
import {
  SCANNER_STUN_ONLY_ICE_SERVERS,
  buildScannerIceServersResponse,
  normalizeScannerIceServers,
  scannerStunOnlyIceServersResponse,
} from "@volt/scanner-protocol";

import { httpAction } from "./_generated/server";
import {
  browserClaimFrom,
  pairingSecretFrom,
  type SignalRequestBody,
  signalBodyFromRequest,
  signalPartsFromRequest,
  stringFrom,
} from "./scannerSignal/httpAdapter";
import {
  logScannerSignalEvent,
  scannerSignalEventForCommand,
  scannerSignalIdTail,
  scannerSignalRouteTemplate,
  type ScannerSignalLogFields,
} from "./scannerSignal/logging";
import { executeScannerSignalRendezvous } from "./scannerSignal/rendezvous";
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

  if (command === "getPushPublicKey") {
    const publicKey = process.env.SCANNER_PUSH_VAPID_PUBLIC_KEY;
    if (!publicKey) return jsonResponse({ error: "Web Push is not configured" }, 404);
    return jsonResponse({ publicKey });
  }

  const reconnectBrowserSessionId = stringFrom(url.searchParams.get("sessionId"), 120);
  const rendezvousBody =
    command === "getPendingReconnectRequests"
      ? { browserSessionId: reconnectBrowserSessionId ?? "" }
      : body;
  return runAndRespond(
    executeScannerSignalRendezvous(ctx, {
      command,
      parts,
      body,
      origin: url.origin,
      startedAt,
      browserClaim: browserClaimFrom(request, body),
      pairingSecret: pairingSecretFrom(request, body),
      pendingReconnectBrowserSessionId: reconnectBrowserSessionId,
    }),
    { ...logContext, requestBody: rendezvousBody },
  );
});

http.route({ path: "/api/signal", method: "GET", handler: signalHandler });
http.route({ path: "/api/signal", method: "POST", handler: signalHandler });
http.route({ path: "/api/signal", method: "OPTIONS", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "GET", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "POST", handler: signalHandler });
http.route({ pathPrefix: "/api/signal/", method: "OPTIONS", handler: signalHandler });

export default http;
