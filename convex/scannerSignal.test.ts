/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";
import { signalRouteCommand } from "./scannerSignal/routeCommands";

const modules = import.meta.glob("./**/*.ts");

describe("scanner signal route command extraction", () => {
  test.each([
    ["POST", ["join-token"], "createJoinToken"],
    ["GET", ["join-token", "token"], "getJoinTokenStatus"],
    ["POST", ["join-token", "token", "revoke"], "revokeJoinToken"],
    ["POST", ["join-token", "token", "rotate"], "rotateJoinToken"],
    ["GET", ["join-token", "token", "attempts"], "listJoinAttempts"],
    ["POST", ["join-token", "token", "attempt"], "createJoinAttempt"],
    ["POST", ["join-token", "token", "attempt", "attempt-id", "offer"], "postJoinOffer"],
    ["GET", ["join-token", "token", "attempt", "attempt-id", "offer"], "getJoinOffer"],
    ["POST", ["join-token", "token", "attempt", "attempt-id", "answer"], "postJoinAnswer"],
    ["GET", ["join-token", "token", "attempt", "attempt-id", "answer"], "getJoinAnswer"],
    ["POST", ["pairings"], "registerPairing"],
    ["GET", ["pairings", "reconnect-requests"], "getPendingReconnectRequests"],
    ["POST", ["pairings", "pairing-id", "reconnect"], "createReconnectRequest"],
    ["GET", ["pairings", "pairing-id", "reconnect", "request-id"], "getReconnectRequestStatus"],
    ["POST", ["pairings", "pairing-id", "reconnect", "request-id", "join-window"], "postReconnectJoinWindow"],
    ["GET", ["ice-servers"], "getIceServers"],
    ["GET", ["push", "public-key"], "getPushPublicKey"],
  ] as const)("maps %s /%s to %s", (method, parts, command) => {
    expect(signalRouteCommand(method, [...parts])).toBe(command);
  });

  test.each([
    ["GET", ["join-token"]],
    ["POST", ["join-token", "token", "attempt", "attempt-id", "candidate"]],
    ["POST", ["pairings", "reconnect-requests"]],
    ["POST", ["pairings", "pairing-id", "reconnect", "request-id"]],
    ["POST", ["ice-servers"]],
    ["GET", ["push", "public-key", "extra"]],
  ] as const)("maps unsupported %s /%s to notFound", (method, parts) => {
    expect(signalRouteCommand(method, [...parts])).toBe("notFound");
  });
});

describe("scanner signal Convex lifecycle", () => {
  test("creates a token, exchanges offer and answer, registers pairing, reconnects, and cleans up expiry", async () => {
    const t = convexTest(schema, modules);
    const origin = "https://adorable-hornet-19.convex.site";

    const created = await t.mutation(internal.scannerSignal.joinTokens.createJoinToken, {
      token: "abcdefghijklmnopqrstuvwxyzABCDEF123456",
      sessionId: "global-session-1",
      browserClaim: "browser-secret",
      ttlMs: 120_000,
      graceMs: 10_000,
      origin,
    });

    expect(created).toMatchObject({
      token: "abcdefghijklmnopqrstuvwxyzABCDEF123456",
      sessionId: "global-session-1",
      browserClaim: "browser-secret",
      joinUrl: `${origin}/api/signal/join-token/abcdefghijklmnopqrstuvwxyzABCDEF123456`,
    });

    const attempt = await t.mutation(internal.scannerSignal.joinAttempts.createJoinAttempt, {
      token: created.token,
      attemptId: "join_attempt_12345",
      contributorId: "device_1234",
      deviceLabel: "iPhone",
      protocolVersion: "1.0.0",
      capabilities: ["ocr", "barcode", "dictation", "photo"],
    });

    expect(attempt.statusCode).toBe(200);
    expect(attempt.body.attempt).toMatchObject({
      id: "join_attempt_12345",
      status: "waiting_for_offer",
      contributorId: "device_1234",
      hasOffer: false,
      hasAnswer: false,
    });

    const offer = JSON.stringify({ type: "offer", sdp: "offer-sdp" });
    const postedOffer = await t.mutation(internal.scannerSignal.joinAttempts.postJoinOffer, {
      token: created.token,
      attemptId: "join_attempt_12345",
      browserClaim: "browser-secret",
      offer,
    });
    expect(postedOffer.body.attempt.status).toBe("offer_posted");

    const fetchedOffer = await t.mutation(internal.scannerSignal.joinAttempts.getJoinOffer, {
      token: created.token,
      attemptId: "join_attempt_12345",
    });
    expect(fetchedOffer.body.offer).toBe(offer);

    const answer = JSON.stringify({ type: "answer", sdp: "answer-sdp" });
    const postedAnswer = await t.mutation(internal.scannerSignal.joinAttempts.postJoinAnswer, {
      token: created.token,
      attemptId: "join_attempt_12345",
      answer,
    });
    expect(postedAnswer.body.attempt.status).toBe("answer_posted");

    const fetchedAnswer = await t.mutation(internal.scannerSignal.joinAttempts.getJoinAnswer, {
      token: created.token,
      attemptId: "join_attempt_12345",
      browserClaim: "browser-secret",
    });
    expect(fetchedAnswer.body.answer).toBe(answer);

    const pairingId = "pairing_test_12345";
    const pairingSecret = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456";
    const browserSessionId = "global-session-reconnect";

    const pairing = await t.mutation(internal.scannerSignal.pairings.registerPairing, {
      pairingId,
      pairingSecret,
      browserSessionId,
      displayName: "Chrome on Mac",
      phoneDeviceId: "phone_1234",
      phoneLabel: "Juan's iPhone",
    });
    expect(pairing.body).toMatchObject({ pairingId, browserSessionId, displayName: "Chrome on Mac" });

    const reconnect = await t.mutation(internal.scannerSignal.reconnectRequests.createReconnectRequest, {
      pairingId,
      pairingSecret,
      requestId: "reconnect_request_12345",
    });
    expect(reconnect.body.request).toMatchObject({
      id: "reconnect_request_12345",
      status: "waiting_for_browser",
    });

    const pending = await t.mutation(internal.scannerSignal.reconnectRequests.getPendingReconnectRequests, {
      browserSessionId,
    });
    expect(pending.body.requests).toEqual([
      expect.objectContaining({
        pairingId,
        requestId: "reconnect_request_12345",
        browserSessionId,
      }),
    ]);

    const joinWindow = await t.mutation(internal.scannerSignal.reconnectRequests.postReconnectJoinWindow, {
      pairingId,
      requestId: "reconnect_request_12345",
      pairingSecret,
      joinUrl: `${origin}/api/signal/join-token/${created.token}`,
      joinToken: created.token,
      sessionId: browserSessionId,
    });
    expect(joinWindow.body.request).toMatchObject({
      id: "reconnect_request_12345",
      status: "join_window_ready",
      joinToken: created.token,
      sessionId: browserSessionId,
    });

    const shortLived = await t.mutation(internal.scannerSignal.joinTokens.createJoinToken, {
      token: "shortlivedtokenabcdefghijklmnopqrstuvwxyz",
      sessionId: "global-session-expiring",
      ttlMs: 1,
      graceMs: 0,
      origin,
    });
    expect(shortLived.token).toBe("shortlivedtokenabcdefghijklmnopqrstuvwxyz");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const cleanup = await t.mutation(internal.scannerSignal.cleanup.cleanupExpired, {});
    expect(cleanup.deleted).toBeGreaterThan(0);

    const expiredLookup = await t.mutation(internal.scannerSignal.joinTokens.getJoinTokenStatus, {
      token: "shortlivedtokenabcdefghijklmnopqrstuvwxyz",
    });
    expect(expiredLookup).toEqual({ statusCode: 404, body: { error: "Join token not found" } });
  });
});
