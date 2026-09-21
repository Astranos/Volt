import {
  scannerStunOnlyIceServersResponse,
  SCANNER_STUN_ONLY_ICE_SERVERS,
  normalizeScannerIceServers,
  buildScannerIceServersResponse,
} from "@volt/scanner-protocol";
import { httpAction } from "../_generated/server";
import { emptyResponse, jsonResponse, accessArgsFromRequest } from "./shared";
import {
  signalPartsFromRequest,
  signalBodyFromRequest,
  stringFrom,
  browserClaimFrom,
  pairingSecretFrom,
} from "../scannerSignal/httpAdapter";
import { signalRouteCommand } from "../scannerSignal/routeCommands";
import { runAndRespond } from "./signalLogging";
import { executeScannerSignalRendezvous } from "../scannerSignal/rendezvous";

const CLOUDFLARE_TURN_GENERATE_ICE_SERVERS_BASE_URL = "https://rtc.live.cloudflare.com/v1/turn/keys";

const DEFAULT_CLOUDFLARE_TURN_TTL_SECONDS = 86_400;

const STUN_FALLBACK_TTL_SECONDS = 300;

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

export const signalHandler = httpAction(async (ctx, request) => {
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
  const access = await accessArgsFromRequest(ctx, request);
  if (!access.ok) return jsonResponse({ error: "Invalid Clerk authorization" }, 401);
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
      auth: access.args,
      anonymousId: access.args.anonymousId,
      anonymousSecret: access.args.anonymousSecret,
    }),
    { ...logContext, requestBody: rendezvousBody },
  );
});
