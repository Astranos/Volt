import assert from "node:assert/strict";
import test from "node:test";

import { MobileScannerSessionLifecycle } from "./mobile-scanner-session-lifecycle.ts";

const joinWindow = {
  sessionId: "global-session-test",
  joinToken: "join-token-test",
  qrCodeUrl: "https://scanner.example.test/pair",
  expiresAt: "2026-06-20T12:00:00.000Z",
};

test("session lifecycle owns join window and peer status ordering", () => {
  let connectedPeerCount = 0;
  const states = [];
  const lifecycle = new MobileScannerSessionLifecycle({
    countConnectedPeers: () => connectedPeerCount,
    initialSessionId: "global-session-initial",
    onState: (state) => states.push(state),
  });

  lifecycle.beginOpenJoinWindow({ cursor: "price", tabTitle: "Listing" });
  assert.equal(states.at(-1).status, "creating");
  assert.deepEqual(states.at(-1).target, { cursor: "price", tabTitle: "Listing" });

  lifecycle.joinWindowOpened(joinWindow, {
    installId: joinWindow.sessionId,
    sessionLabel: "Chrome",
    createdAt: "2026-06-20T12:00:00.000Z",
  });
  assert.equal(states.at(-1).status, "waiting");
  assert.equal(states.at(-1).qrCodeUrl, joinWindow.qrCodeUrl);
  assert.equal(states.at(-1).joinWindowExpiresAt, joinWindow.expiresAt);
  assert.equal(lifecycle.getSessionId(), joinWindow.sessionId);

  connectedPeerCount = 1;
  lifecycle.peerConnected();
  assert.equal(states.at(-1).status, "connected");
  assert.equal(states.at(-1).connectedPeerCount, 1);
  assert.equal(typeof states.at(-1).connectedAt, "string");

  assert.equal(lifecycle.takeJoinWindowForClose(), joinWindow);
  lifecycle.joinWindowClosed();
  assert.equal(states.at(-1).status, "connected");
  assert.equal(states.at(-1).qrCodeUrl, null);
  assert.equal(states.at(-1).joinWindowExpiresAt, null);

  connectedPeerCount = 0;
  lifecycle.peerClosed();
  assert.equal(states.at(-1).status, "disconnected");
  assert.equal(states.at(-1).connectedAt, null);
  assert.equal(states.at(-1).connectedPeerCount, 0);
});

test("session lifecycle keeps waiting state when a peer closes during an active join window", () => {
  let connectedPeerCount = 1;
  const states = [];
  const lifecycle = new MobileScannerSessionLifecycle({
    countConnectedPeers: () => connectedPeerCount,
    initialSessionId: "global-session-initial",
    onState: (state) => states.push(state),
  });

  lifecycle.joinWindowOpened(joinWindow);
  connectedPeerCount = 0;
  lifecycle.peerClosed();

  assert.equal(states.at(-1).status, "waiting");
  assert.equal(states.at(-1).connectedPeerCount, 0);
});
