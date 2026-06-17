import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import associationHandler, { buildAssociationPayload } from "./apple-app-site-association.ts";
import signalHandler from "./signal.ts";

const signalSource = readFileSync(new URL("./signal.ts", import.meta.url), "utf8");

function makeResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    json(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function makeRequest({ method = "GET", path, query = {}, body, headers = {} } = {}) {
  return {
    method,
    query: path ? { ...query, path } : query,
    body,
    headers,
    url: path ? `/api/signal/${path}` : "/api/signal",
  };
}

test("apple-app-site-association does not advertise scanner routes", () => {
  const response = makeResponse();

  associationHandler(makeRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json");
  assert.deepEqual(response.body, {
    applinks: { apps: [], details: [] },
  });
  assert.equal("appclips" in buildAssociationPayload(), false);
});

test("signal rejects legacy relay session creation", async () => {
  const response = makeResponse();

  await signalHandler(makeRequest({ method: "POST", body: { relay: true, mode: "barcode" } }), response);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "Not found" });
});

test("signal rejects legacy HTTPS result and photo object transfer endpoints", async () => {
  for (const request of [
    makeRequest({ method: "POST", path: "session_123/result", body: {} }),
    makeRequest({ method: "GET", path: "session_123/result" }),
    makeRequest({ method: "POST", path: "session_123/photo/grant", body: {} }),
    makeRequest({ method: "POST", path: "session_123/photo/upload/grant_1", body: {} }),
    makeRequest({ method: "GET", path: "session_123/photo/manifest" }),
    makeRequest({ method: "POST", path: "session_123/photo/ack", body: {} }),
    makeRequest({ method: "GET", path: "photo/object/mobile-scanner/session_123/photo.jpg" }),
  ]) {
    const response = makeResponse();
    await signalHandler(request, response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, { error: "Not found" });
  }
});

test("signal CORS allows reconnect pairing secret header", async () => {
  const response = makeResponse();

  await signalHandler(
    makeRequest({
      method: "OPTIONS",
      path: "pairings/pairing_test_12345/reconnect/request_12345",
    }),
    response
  );

  assert.equal(response.statusCode, 204);
  assert.match(response.headers["access-control-allow-headers"], /X-Volt-Pairing-Secret/);
});

test("signal join token supports multiple WebRTC attempts with offer and answer polling", async () => {
  const createResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: "join-token",
      body: { browserClaim: "browser-secret", sessionId: "global-session-1", ttlMs: 30_000 },
      headers: { host: "scanner-signal.example", "x-forwarded-proto": "https" },
    }),
    createResponse
  );

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.body.sessionId, "global-session-1");
  assert.match(createResponse.body.token, /^[a-zA-Z0-9_-]{32,}$/);
  assert.match(createResponse.body.joinUrl, /^https:\/\/scanner-signal\.example\/api\/signal\/join-token\//);

  const attemptResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `join-token/${createResponse.body.token}/attempt`,
      body: {
        contributorId: "device_1234",
        deviceLabel: "iPhone",
        protocolVersion: "1.0.0",
        capabilities: ["ocr", "barcode", "dictation", "photo"],
      },
    }),
    attemptResponse
  );

  assert.equal(attemptResponse.statusCode, 200);
  assert.equal(attemptResponse.body.attempt.status, "waiting_for_offer");
  assert.equal(attemptResponse.body.attempt.contributorId, "device_1234");

  const attemptsResponse = makeResponse();
  await signalHandler(
    makeRequest({
      path: `join-token/${createResponse.body.token}/attempts`,
      body: { browserClaim: "browser-secret" },
    }),
    attemptsResponse
  );

  assert.equal(attemptsResponse.statusCode, 200);
  assert.equal(attemptsResponse.body.attempts.length, 1);

  const offerResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `join-token/${createResponse.body.token}/attempt/${attemptResponse.body.attempt.id}/offer`,
      body: { browserClaim: "browser-secret", offer: JSON.stringify({ type: "offer", sdp: "offer-sdp" }) },
    }),
    offerResponse
  );

  assert.equal(offerResponse.statusCode, 200);
  assert.equal(offerResponse.body.attempt.status, "offer_posted");

  const pollOfferResponse = makeResponse();
  await signalHandler(
    makeRequest({
      path: `join-token/${createResponse.body.token}/attempt/${attemptResponse.body.attempt.id}/offer`,
    }),
    pollOfferResponse
  );

  assert.equal(pollOfferResponse.statusCode, 200);
  assert.equal(JSON.parse(pollOfferResponse.body.offer).sdp, "offer-sdp");

  const answerResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `join-token/${createResponse.body.token}/attempt/${attemptResponse.body.attempt.id}/answer`,
      body: { answer: JSON.stringify({ type: "answer", sdp: "answer-sdp" }) },
    }),
    answerResponse
  );

  assert.equal(answerResponse.statusCode, 200);
  assert.equal(answerResponse.body.attempt.status, "answer_posted");

  const pollAnswerResponse = makeResponse();
  await signalHandler(
    makeRequest({
      path: `join-token/${createResponse.body.token}/attempt/${attemptResponse.body.attempt.id}/answer`,
      body: { browserClaim: "browser-secret" },
    }),
    pollAnswerResponse
  );

  assert.equal(pollAnswerResponse.statusCode, 200);
  assert.equal(JSON.parse(pollAnswerResponse.body.answer).sdp, "answer-sdp");
});

test("signal protects browser-owned join-token routes with the browser claim", async () => {
  const createResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: "join-token",
      body: { browserClaim: "browser-secret", sessionId: "global-session-2" },
    }),
    createResponse
  );

  const protectedResponse = makeResponse();
  await signalHandler(
    makeRequest({
      path: `join-token/${createResponse.body.token}/attempts`,
    }),
    protectedResponse
  );

  assert.equal(protectedResponse.statusCode, 403);
  assert.deepEqual(protectedResponse.body, { error: "Browser claim required" });
});

test("signal can revoke and rotate visible join tokens", async () => {
  const createResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: "join-token",
      body: { browserClaim: "browser-secret", sessionId: "global-session-3" },
    }),
    createResponse
  );

  const rotateResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `join-token/${createResponse.body.token}/rotate`,
      body: { browserClaim: "browser-secret", ttlMs: 30_000 },
    }),
    rotateResponse
  );

  assert.equal(rotateResponse.statusCode, 200);
  assert.equal(rotateResponse.body.previous.rotatedTo, rotateResponse.body.token.token);
  assert.equal(rotateResponse.body.token.sessionId, "global-session-3");

  const revokeResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `join-token/${rotateResponse.body.token.token}/revoke`,
      body: { browserClaim: "browser-secret" },
    }),
    revokeResponse
  );

  assert.equal(revokeResponse.statusCode, 200);
  assert.equal(revokeResponse.body.success, true);
  assert.match(revokeResponse.body.revokedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("signal durable pairings broker fresh reconnect join windows", async () => {
  const pairingId = "pairing_test_12345";
  const pairingSecret = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456";
  const browserSessionId = "global-session-reconnect";

  const registerResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: "pairings",
      body: {
        pairingId,
        pairingSecret,
        browserSessionId,
        displayName: "Chrome on Mac",
      },
    }),
    registerResponse
  );

  assert.equal(registerResponse.statusCode, 200);
  assert.equal(registerResponse.body.pairingId, pairingId);

  const reconnectResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `pairings/${pairingId}/reconnect`,
      body: { pairingSecret },
    }),
    reconnectResponse
  );

  assert.equal(reconnectResponse.statusCode, 200);
  assert.equal(reconnectResponse.body.request.status, "waiting_for_browser");

  const pendingResponse = makeResponse();
  await signalHandler(
    makeRequest({
      path: "pairings/reconnect-requests",
      query: { sessionId: browserSessionId },
    }),
    pendingResponse
  );

  assert.equal(pendingResponse.statusCode, 200);
  assert.equal(pendingResponse.body.requests.length, 1);
  assert.equal(pendingResponse.body.requests[0].pairingId, pairingId);

  const joinToken = "abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890";
  const joinWindowResponse = makeResponse();
  await signalHandler(
    makeRequest({
      method: "POST",
      path: `pairings/${pairingId}/reconnect/${reconnectResponse.body.request.id}/join-window`,
      body: {
        pairingSecret,
        joinUrl: `volt://pair?token=${joinToken}&sessionId=${browserSessionId}`,
        joinToken,
        sessionId: browserSessionId,
      },
    }),
    joinWindowResponse
  );

  assert.equal(joinWindowResponse.statusCode, 200);
  assert.equal(joinWindowResponse.body.request.status, "join_window_ready");

  const pollResponse = makeResponse();
  await signalHandler(
    makeRequest({
      path: `pairings/${pairingId}/reconnect/${reconnectResponse.body.request.id}`,
      body: { pairingSecret },
    }),
    pollResponse
  );

  assert.equal(pollResponse.statusCode, 200);
  assert.equal(pollResponse.body.request.joinToken, joinToken);
});

test("signal supports Web Push wake subscriptions for durable reconnect", () => {
  assert.match(signalSource, /import webPush from "web-push"/);
  assert.match(signalSource, /SCANNER_PUSH_VAPID_PUBLIC_KEY/);
  assert.match(signalSource, /function normalizePushSubscription/);
  assert.match(signalSource, /pushSubscription: pushSubscription \?\? existing\?\.pushSubscription/);
  assert.match(signalSource, /await sendReconnectWakePush\(nextRecord, reconnectRequest\.id\)/);
  assert.match(signalSource, /parts\[1\] === "public-key"/);
});
