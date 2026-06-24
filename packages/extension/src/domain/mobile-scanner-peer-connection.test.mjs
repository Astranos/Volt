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
  assert.deepEqual(rtc.instances[0].transceivers, [{ kind: "audio", init: { direction: "recvonly" } }]);
  assert.deepEqual(rtc.instances[0].operations.slice(0, 2), ["addTransceiver:audio", "createDataChannel:scanner-control"]);
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

test("peer offer creation removes partial peer when posting the offer fails", async () => {
  installFakeRTCPeerConnection();
  const peerConnections = new MobileScannerPeerConnections(
    {
      fetchIceServers: async () => turnIceServers,
      postPeerOffer: async () => {
        throw new Error("signal unavailable");
      },
    },
    createEvents(),
  );

  await assert.rejects(peerConnections.createPeerOffer(joinWindow, "attempt-failed"), /signal unavailable/);

  assert.equal(peerConnections.peers.has("attempt-failed"), false);
});

test("peer connection forwards remote audio tracks", async () => {
  const rtc = installFakeRTCPeerConnection();
  const remoteTracks = [];
  const peerConnections = new MobileScannerPeerConnections(
    {
      fetchIceServers: async () => turnIceServers,
      postPeerOffer: async () => {},
    },
    createEvents({
      onRemoteAudioTrack: (peer, track, streams) => remoteTracks.push({ peer, track, streams }),
    }),
  );

  await peerConnections.createPeerOffer(joinWindow, "attempt-audio");

  const track = { kind: "audio" };
  const stream = { id: "remote-stream" };
  rtc.instances[0].ontrack({ track, streams: [stream] });

  assert.equal(remoteTracks.length, 1);
  assert.equal(remoteTracks[0].peer.id, "attempt-audio");
  assert.equal(remoteTracks[0].track, track);
  assert.deepEqual(remoteTracks[0].streams, [stream]);
});

test("peer connection waits through transient disconnected state", async () => {
  const rtc = installFakeRTCPeerConnection();
  const disconnected = [];
  const peerConnections = new MobileScannerPeerConnections(
    {
      fetchIceServers: async () => turnIceServers,
      postPeerOffer: async () => {},
    },
    createEvents({
      disconnectGraceMs: 10,
      onPeerDisconnected: (peer) => disconnected.push(peer.id),
    }),
  );

  await peerConnections.createPeerOffer(joinWindow, "attempt-transient");

  const pc = rtc.instances[0];
  pc.connectionState = "disconnected";
  pc.onconnectionstatechange();
  pc.connectionState = "connected";
  pc.onconnectionstatechange();
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(disconnected, []);
  assert.equal(peerConnections.peers.has("attempt-transient"), true);
});

test("peer connection closes after sustained disconnected state", async () => {
  const rtc = installFakeRTCPeerConnection();
  const disconnected = [];
  const peerConnections = new MobileScannerPeerConnections(
    {
      fetchIceServers: async () => turnIceServers,
      postPeerOffer: async () => {},
    },
    createEvents({
      disconnectGraceMs: 5,
      onPeerDisconnected: (peer) => disconnected.push(peer.id),
    }),
  );

  await peerConnections.createPeerOffer(joinWindow, "attempt-sustained");

  const pc = rtc.instances[0];
  pc.connectionState = "disconnected";
  pc.onconnectionstatechange();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(disconnected, ["attempt-sustained"]);
});

function createEvents({ log = () => {}, onRemoteAudioTrack = () => {}, onPeerDisconnected = () => {}, disconnectGraceMs } = {}) {
  return {
    configureControlChannel: () => {},
    configurePhotoChannel: () => {},
    disconnectGraceMs,
    onPeerConnected: () => {},
    onPeerDisconnected,
    onRemoteAudioTrack,
    log,
  };
}

function installFakeRTCPeerConnection() {
  const configs = [];
  const instances = [];

  globalThis.RTCPeerConnection = class FakeRTCPeerConnection {
    connectionState = "new";
    iceGatheringState = "complete";
    localDescription = null;
    onconnectionstatechange = null;
    onicegatheringstatechange = null;
    ontrack = null;
    operations = [];
    transceivers = [];

    constructor(config) {
      configs.push(config);
      instances.push(this);
    }

    addTransceiver(kind, init) {
      this.operations.push(`addTransceiver:${kind}`);
      this.transceivers.push({ kind, init });
    }

    createDataChannel(label) {
      this.operations.push(`createDataChannel:${label}`);
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

  return { configs, instances };
}
