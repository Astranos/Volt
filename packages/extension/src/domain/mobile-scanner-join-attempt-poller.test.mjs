import assert from "node:assert/strict";
import test from "node:test";

import {
  MobileScannerJoinAttemptPoller,
  MobileScannerReconnectPoller,
} from "./mobile-scanner-join-attempt-poller.ts";

const joinWindow = {
  sessionId: "global-session-test",
  joinToken: "join-token-test",
  qrCodeUrl: "https://scanner.example.test/pair",
  expiresAt: "2026-06-20T12:00:00.000Z",
};

const answer = {
  type: "answer",
  sdp: "v=0\r\n",
};

test("join attempt poller creates offers and applies available answers", async () => {
  let activeJoinWindow = joinWindow;
  const calls = [];
  const peers = new Map();
  const poller = new MobileScannerJoinAttemptPoller({
    getActiveJoinWindow: () => activeJoinWindow,
    initialPollIntervalMs: 20,
    maxPollIntervalMs: 20,
    hiddenPollingGraceMs: 20,
    signalClient: {
      fetchJoinAttempts: async () => [
        { joinAttemptId: "attempt-1", answer, hasAnswer: true },
      ],
      fetchPeerAnswer: async () => null,
    },
    peerConnections: {
      peers,
      createPeerOffer: async (_window, joinAttemptId) => {
        calls.push(["offer", joinAttemptId]);
        peers.set(joinAttemptId, { id: joinAttemptId, answerApplied: false });
      },
      applyPeerAnswer: async (joinAttemptId, peerAnswer) => {
        calls.push(["answer", joinAttemptId, peerAnswer.type]);
        peers.get(joinAttemptId).answerApplied = true;
      },
    },
  });

  poller.start(joinWindow);
  await waitForPoll();
  activeJoinWindow = null;
  poller.clear();

  assert.deepEqual(calls, [
    ["offer", "attempt-1"],
    ["answer", "attempt-1", "answer"],
  ]);
});

test("hidden join polling only finishes answers for attempts seen while the window was active", async () => {
  let activeJoinWindow = joinWindow;
  let fetchCount = 0;
  const calls = [];
  const peers = new Map();
  const poller = new MobileScannerJoinAttemptPoller({
    getActiveJoinWindow: () => activeJoinWindow,
    initialPollIntervalMs: 5,
    maxPollIntervalMs: 5,
    hiddenPollingGraceMs: 50,
    signalClient: {
      fetchJoinAttempts: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return [{ joinAttemptId: "known-attempt", answer: null, hasAnswer: false }];
        }
        return [
          { joinAttemptId: "known-attempt", answer, hasAnswer: true },
          { joinAttemptId: "new-after-close", answer, hasAnswer: true },
        ];
      },
      fetchPeerAnswer: async () => null,
    },
    peerConnections: {
      peers,
      createPeerOffer: async (_window, joinAttemptId) => {
        calls.push(["offer", joinAttemptId]);
        peers.set(joinAttemptId, { id: joinAttemptId, answerApplied: false });
      },
      applyPeerAnswer: async (joinAttemptId) => {
        calls.push(["answer", joinAttemptId]);
        peers.get(joinAttemptId).answerApplied = true;
      },
    },
  });

  poller.start(joinWindow);
  await waitForPoll();
  activeJoinWindow = null;
  poller.continueHiddenPollingFor(joinWindow);
  await new Promise((resolve) => setTimeout(resolve, 20));
  poller.clear();

  assert.deepEqual(calls, [
    ["offer", "known-attempt"],
    ["answer", "known-attempt"],
  ]);
});

test("reconnect poller answers durable pairing requests once", async () => {
  const calls = [];
  const pairing = {
    pairingId: "pairing_123456",
    pairingSecret: "secret",
    browserSessionId: "global-session-test",
    displayName: "Chrome",
    createdAt: "2026-06-20T12:00:00.000Z",
    lastConnectedAt: "2026-06-20T12:00:00.000Z",
  };
  const poller = new MobileScannerReconnectPoller({
    getSessionId: () => "global-session-test",
    getDurablePairings: async () => [pairing],
    createReconnectJoinWindow: async (requestPairing, requestId) => {
      calls.push(["create", requestPairing.pairingId, requestId]);
      return joinWindow;
    },
    signalClient: {
      fetchReconnectRequests: async () => ({
        response: { ok: true, status: 200 },
        requests: [
          { pairingId: pairing.pairingId, requestId: "request-1" },
          { pairingId: "unknown_pairing", requestId: "request-2" },
        ],
      }),
      postReconnectJoinWindow: async (requestPairing, requestId, requestJoinWindow) => {
        calls.push(["post", requestPairing.pairingId, requestId, requestJoinWindow.joinToken]);
      },
    },
  });

  await poller.pollNow();
  await poller.pollNow();

  assert.deepEqual(calls, [
    ["create", pairing.pairingId, "request-1"],
    ["post", pairing.pairingId, "request-1", joinWindow.joinToken],
  ]);
});

test("reconnect poller skips invalid session ids before fetching pairings", async () => {
  let pairingFetchCount = 0;
  const logs = [];
  const poller = new MobileScannerReconnectPoller({
    getSessionId: () => "no spaces allowed",
    getDurablePairings: async () => {
      pairingFetchCount += 1;
      return [];
    },
    createReconnectJoinWindow: async () => joinWindow,
    signalClient: {
      fetchReconnectRequests: async () => {
        throw new Error("should not fetch reconnect requests");
      },
      postReconnectJoinWindow: async () => {},
    },
    log: (...args) => logs.push(args),
  });

  await poller.pollNow();

  assert.equal(pairingFetchCount, 0);
  assert.equal(logs[0][0], "[Volt Scanner Reconnect] poll skipped: invalid session id");
});

function waitForPoll() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
