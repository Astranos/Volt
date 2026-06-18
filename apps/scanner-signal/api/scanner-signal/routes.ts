import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  type PublicPendingScannerReconnectRequest,
  isScannerJoinAttemptId,
  isScannerJoinToken,
  isScannerJoinTokenActiveForNewAttempt,
  isScannerPairingId,
  isScannerSessionId,
  normalizeScannerJoinToken,
  normalizeScannerPairing,
  publicPendingScannerReconnectRequest,
  publicScannerJoinAttempt,
  publicScannerJoinToken,
  publicScannerReconnectRequest,
  scannerSignalIso,
} from "../../../../packages/scanner-protocol/src/index.ts";
import { normalizePushSubscription, publicPushKey, sendReconnectWakePush } from "./push.ts";
import {
  pairingRouteParts,
  pushRouteParts,
  makeSecretId,
  requestOrigin,
  requireJoinTokenBrowserClaim,
  requirePairingSecret,
  stringFromBody,
  tokenRouteParts,
} from "./request.ts";
import { signalStorage } from "./storage.ts";
import {
  appendJoinAttempt,
  appendReconnectRequest,
  createJoinTokenRecord,
  normalizePairingsForPendingReconnect,
  postJoinAnswer,
  postJoinOffer,
  postReconnectJoinWindow,
  refreshJoinAttemptExpiry,
  refreshReconnectRequestExpiry,
  revokeJoinToken,
  rotateJoinToken,
  upsertPairingRecord,
} from "./transitions.ts";

export async function handleJoinTokenRoute(request: VercelRequest, response: VercelResponse) {
  const parts = tokenRouteParts(request);
  if (parts.length === 0) return false;

  if (request.method === "POST" && parts.length === 1) {
    const { record } = createJoinTokenRecord(request.body ?? {});
    await signalStorage.saveJoinToken(record);
    response.status(200).json({
      ...publicScannerJoinToken(record),
      browserClaim: record.browserClaim,
      joinUrl: `${requestOrigin(request)}/api/signal/join-token/${encodeURIComponent(record.token)}`,
    });
    return true;
  }

  const token = parts[1];
  if (!isScannerJoinToken(token)) {
    response.status(400).json({ error: "Invalid join token" });
    return true;
  }

  const existing = await signalStorage.getJoinToken(token);
  if (!existing) {
    response.status(404).json({ error: "Join token not found" });
    return true;
  }
  const record = normalizeScannerJoinToken(existing);

  if (request.method === "GET" && parts.length === 2) {
    response.status(200).json({
      ...publicScannerJoinToken(record),
      active: isScannerJoinTokenActiveForNewAttempt(record),
      attempts: record.attempts.map(publicScannerJoinAttempt),
    });
    return true;
  }

  if (request.method === "POST" && parts[2] === "revoke" && parts.length === 3) {
    if (!requireJoinTokenBrowserClaim(record, request, response)) return true;
    const revoked = revokeJoinToken(record);
    await signalStorage.saveJoinToken(revoked);
    response.status(200).json({ success: true, ...publicScannerJoinToken(revoked) });
    return true;
  }

  if (request.method === "POST" && parts[2] === "rotate" && parts.length === 3) {
    if (!requireJoinTokenBrowserClaim(record, request, response)) return true;
    const { previousRecord, nextRecord } = rotateJoinToken(record, request.body ?? {});
    await signalStorage.saveJoinToken(previousRecord);
    await signalStorage.saveJoinToken(nextRecord);
    response.status(200).json({
      previous: publicScannerJoinToken(previousRecord),
      token: publicScannerJoinToken(nextRecord),
      joinUrl: `${requestOrigin(request)}/api/signal/join-token/${encodeURIComponent(nextRecord.token)}`,
    });
    return true;
  }

  if (request.method === "GET" && parts[2] === "attempts" && parts.length === 3) {
    if (!requireJoinTokenBrowserClaim(record, request, response)) return true;
    response.status(200).json({ attempts: record.attempts.map(publicScannerJoinAttempt) });
    return true;
  }

  if (request.method === "POST" && parts[2] === "attempt" && parts.length === 3) {
    if (!isScannerJoinTokenActiveForNewAttempt(record)) {
      response.status(410).json({ error: record.revokedAt ? "Join token revoked" : "Join token expired" });
      return true;
    }
    const { nextRecord, attempt } = appendJoinAttempt(record, request.body ?? {});
    await signalStorage.saveJoinToken(nextRecord);
    response.status(200).json({ attempt: publicScannerJoinAttempt(attempt), token: publicScannerJoinToken(nextRecord) });
    return true;
  }

  if (parts[2] !== "attempt" || !isScannerJoinAttemptId(parts[3])) {
    response.status(404).json({ error: "Not found" });
    return true;
  }

  const attemptId = parts[3];
  const route = parts[4];
  const { attempt, nextRecord, changed } = refreshJoinAttemptExpiry(record, attemptId);
  if (!attempt) {
    response.status(404).json({ error: "Join attempt not found" });
    return true;
  }
  const attemptExpired = attempt.status === "expired";

  if (route === "offer" && request.method === "POST" && parts.length === 5) {
    if (!requireJoinTokenBrowserClaim(record, request, response)) return true;
    if (attemptExpired) {
      if (changed) await signalStorage.saveJoinToken(nextRecord);
      response.status(410).json({ error: "Join attempt expired" });
      return true;
    }
    const offer = stringFromBody(request.body?.offer, 200_000);
    if (!offer) {
      response.status(400).json({ error: "Missing offer" });
      return true;
    }
    const transition = postJoinOffer(record, attempt, offer);
    await signalStorage.saveJoinToken(transition.nextRecord);
    response.status(200).json({ success: true, attempt: publicScannerJoinAttempt(transition.nextAttempt) });
    return true;
  }

  if (route === "offer" && request.method === "GET" && parts.length === 5) {
    if (attemptExpired) {
      if (changed) await signalStorage.saveJoinToken(nextRecord);
      response.status(410).json({ error: "Join attempt expired" });
      return true;
    }
    response.status(200).json({
      offer: attempt.offer ?? null,
      attempt: publicScannerJoinAttempt(attempt),
    });
    return true;
  }

  if (route === "answer" && request.method === "POST" && parts.length === 5) {
    if (attemptExpired) {
      if (changed) await signalStorage.saveJoinToken(nextRecord);
      response.status(410).json({ error: "Join attempt expired" });
      return true;
    }
    const answer = stringFromBody(request.body?.answer, 200_000);
    if (!answer) {
      response.status(400).json({ error: "Missing answer" });
      return true;
    }
    if (!attempt.offer) {
      response.status(409).json({ error: "Offer required before answer" });
      return true;
    }
    const transition = postJoinAnswer(record, attempt, answer);
    await signalStorage.saveJoinToken(transition.nextRecord);
    response.status(200).json({ success: true, attempt: publicScannerJoinAttempt(transition.nextAttempt) });
    return true;
  }

  if (route === "answer" && request.method === "GET" && parts.length === 5) {
    if (!requireJoinTokenBrowserClaim(record, request, response)) return true;
    response.status(200).json({
      answer: attempt.answer ?? null,
      attempt: publicScannerJoinAttempt(attempt),
    });
    return true;
  }

  response.status(404).json({ error: "Not found" });
  return true;
}

export async function handlePairingRoute(request: VercelRequest, response: VercelResponse) {
  const parts = pairingRouteParts(request);
  if (parts.length === 0) return false;

  if (request.method === "POST" && parts.length === 1) {
    const pairingId = stringFromBody(request.body?.pairingId, 120) ?? makeSecretId(18);
    const pairingSecret = stringFromBody(request.body?.pairingSecret, 240) ?? makeSecretId(32);
    const browserSessionId = stringFromBody(request.body?.browserSessionId ?? request.body?.sessionId, 120);
    if (!isScannerPairingId(pairingId)) {
      response.status(400).json({ error: "Invalid pairing id" });
      return true;
    }
    if (!isScannerJoinToken(pairingSecret)) {
      response.status(400).json({ error: "Invalid pairing secret" });
      return true;
    }
    if (!isScannerSessionId(browserSessionId)) {
      response.status(400).json({ error: "Invalid browser session id" });
      return true;
    }

    const existing = await signalStorage.getPairing(pairingId);
    if (existing && existing.secret !== pairingSecret) {
      response.status(409).json({ error: "Pairing already exists" });
      return true;
    }
    const pushSubscription = normalizePushSubscription(request.body?.pushSubscription);
    console.info("[scanner-signal] Pairing registration", {
      pairingId,
      browserSessionId,
      hasPushSubscription: Boolean(pushSubscription ?? existing?.pushSubscription),
      receivedPushSubscription: Boolean(pushSubscription),
    });

    const record = upsertPairingRecord(existing, {
      pairingId,
      pairingSecret,
      browserSessionId,
      body: request.body ?? {},
      pushSubscription,
    });
    await signalStorage.savePairing(record);
    response.status(200).json({
      pairingId: record.id,
      browserSessionId: record.browserSessionId,
      displayName: record.displayName,
      expiresAt: scannerSignalIso(record.expiresAt),
    });
    return true;
  }

  if (request.method === "GET" && parts[1] === "reconnect-requests" && parts.length === 2) {
    const browserSessionId = stringFromBody(request.query.sessionId, 120);
    if (!isScannerSessionId(browserSessionId)) {
      response.status(400).json({ error: "Invalid browser session id" });
      return true;
    }
    const pending: PublicPendingScannerReconnectRequest[] = [];
    for (const { pairing, changed } of normalizePairingsForPendingReconnect(
      await signalStorage.getPairingsForBrowserSession(browserSessionId)
    )) {
      if (changed) await signalStorage.savePairing(pairing);
      for (const reconnectRequest of pairing.reconnectRequests) {
        if (reconnectRequest.status === "waiting_for_browser") {
          pending.push(publicPendingScannerReconnectRequest(pairing, reconnectRequest));
        }
      }
    }
    response.status(200).json({ requests: pending });
    return true;
  }

  const pairingId = parts[1];
  if (!isScannerPairingId(pairingId)) {
    response.status(400).json({ error: "Invalid pairing id" });
    return true;
  }

  const existing = await signalStorage.getPairing(pairingId);
  if (!existing) {
    response.status(404).json({ error: "Pairing not found" });
    return true;
  }
  const record = normalizeScannerPairing(existing);

  if (request.method === "POST" && parts[2] === "reconnect" && parts.length === 3) {
    if (!requirePairingSecret(record, request, response)) return true;
    const { nextRecord, reconnectRequest } = appendReconnectRequest(record);
    await signalStorage.savePairing(nextRecord);
    await sendReconnectWakePush(nextRecord, reconnectRequest.id);
    response.status(200).json({
      pairingId: record.id,
      browserSessionId: record.browserSessionId,
      request: publicScannerReconnectRequest(reconnectRequest),
    });
    return true;
  }

  if (parts[2] !== "reconnect" || !isScannerJoinAttemptId(parts[3])) {
    response.status(404).json({ error: "Not found" });
    return true;
  }

  const requestId = parts[3];
  const { reconnectRequest, nextRecord, changed } = refreshReconnectRequestExpiry(record, requestId);
  if (!reconnectRequest) {
    response.status(404).json({ error: "Reconnect request not found" });
    return true;
  }

  if (request.method === "GET" && parts.length === 4) {
    if (!requirePairingSecret(record, request, response)) return true;
    if (changed) await signalStorage.savePairing(nextRecord);
    response.status(200).json({ request: publicScannerReconnectRequest(reconnectRequest) });
    return true;
  }

  if (request.method === "POST" && parts[4] === "join-window" && parts.length === 5) {
    if (!requirePairingSecret(record, request, response)) return true;
    if (reconnectRequest.status === "expired") {
      if (changed) await signalStorage.savePairing(nextRecord);
      response.status(410).json({ error: "Reconnect request expired" });
      return true;
    }
    const joinUrl = stringFromBody(request.body?.joinUrl, 1000);
    const joinToken = stringFromBody(request.body?.joinToken, 240);
    const sessionId = stringFromBody(request.body?.sessionId, 120) ?? record.browserSessionId;
    if (!joinUrl || !isScannerJoinToken(joinToken) || !isScannerSessionId(sessionId)) {
      response.status(400).json({ error: "Invalid join window" });
      return true;
    }
    const transition = postReconnectJoinWindow(record, reconnectRequest, { joinUrl, joinToken, sessionId });
    await signalStorage.savePairing(transition.nextRecord);
    response.status(200).json({ success: true, request: publicScannerReconnectRequest(transition.nextRequest) });
    return true;
  }

  response.status(404).json({ error: "Not found" });
  return true;
}

export async function handlePushRoute(request: VercelRequest, response: VercelResponse) {
  const parts = pushRouteParts(request);
  if (parts.length === 0) return false;

  if (request.method === "GET" && parts[1] === "public-key" && parts.length === 2) {
    const publicKey = publicPushKey();
    if (!publicKey) {
      response.status(404).json({ error: "Web Push is not configured" });
      return true;
    }
    response.status(200).json({ publicKey });
    return true;
  }

  response.status(404).json({ error: "Not found" });
  return true;
}
