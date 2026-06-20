import assert from "node:assert/strict";
import test from "node:test";

import { MobileScannerJoinAttemptPoller } from "./mobile-scanner-join-attempt-poller.ts";

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

function waitForPoll() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
