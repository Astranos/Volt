import assert from "node:assert/strict";
import test from "node:test";

import { SCANNER_STUN_ONLY_ICE_SERVERS } from "@volt/scanner-protocol";
import { MobileScannerPeerConnections } from "./mobile-scanner-peer-connection.ts";

const joinWindow = {
  sessionId: "global-session-test",
  joinToken: "join-token-test",
  qrCodeUrl: "https://scanner.example.test/pair",
  expiresAt: "2026-06-20T12:00:00.000Z",
};

const turnIceServers = [
  { urls: "stun:stun.example.test:3478" },
  {
    urls: ["turn:turn.example.test:3478?transport=udp", "turns:turn.example.test:5349?transport=tcp"],
    username: "short-lived-user",
    credential: "short-lived-secret",
  },
];

test("peer offer creation fetches ICE servers before creating RTCPeerConnection", async () => {
  const rtc = installFakeRTCPeerConnection();
  const offers = [];
  const peerConnections = new MobileScannerPeerConnections(
    {
      fetchIceServers: async () => turnIceServers,
      postPeerOffer: async (_joinWindow, joinAttemptId, offer) => {
        offers.push({ joinAttemptId, offer });
      },
    },
    createEvents(),
  );

  await peerConnections.createPeerOffer(joinWindow, "attempt-turn");

  assert.deepEqual(rtc.configs, [{ iceServers: turnIceServers }]);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].joinAttemptId, "attempt-turn");
  assert.equal(offers[0].offer.type, "offer");
});

test("peer offer creation falls back to static STUN servers when ICE fetch fails", async () => {
  const rtc = installFakeRTCPeerConnection();
  const logs = [];
  const offers = [];
  const peerConnections = new MobileScannerPeerConnections(
    {
      fetchIceServers: async () => {
        throw new Error("turn unavailable");
      },
      postPeerOffer: async (_joinWindow, joinAttemptId, offer) => {
        offers.push({ joinAttemptId, offer });
      },
    },
    createEvents({ log: (...args) => logs.push(args) }),
  );

  await peerConnections.createPeerOffer(joinWindow, "attempt-stun");

  assert.deepEqual(rtc.configs, [{ iceServers: SCANNER_STUN_ONLY_ICE_SERVERS }]);
  assert.equal(offers.length, 1);
  assert.equal(logs.some(([message]) => message === "[Volt Scanner Pairing] falling back to STUN-only ICE servers"), true);
});

function createEvents({ log = () => {} } = {}) {
  return {
    configureControlChannel: () => {},
    configurePhotoChannel: () => {},
    onPeerConnected: () => {},
    onPeerDisconnected: () => {},
    log,
  };
}

function installFakeRTCPeerConnection() {
  const configs = [];

  globalThis.RTCPeerConnection = class FakeRTCPeerConnection {
    connectionState = "new";
    iceGatheringState = "complete";
    localDescription = null;
    onconnectionstatechange = null;
    onicegatheringstatechange = null;

    constructor(config) {
      configs.push(config);
    }

    createDataChannel(label) {
      return {
        label,
        close() {},
      };
    }

    async createOffer() {
      return { type: "offer", sdp: "v=0\r\n" };
    }

    async setLocalDescription(description) {
      this.localDescription = description;
    }

    async setRemoteDescription() {}

    close() {
      this.connectionState = "closed";
    }
  };

  return { configs };
}
