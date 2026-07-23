import assert from "node:assert/strict";
import test from "node:test";

import { MobileScannerPeerCoordinator } from "./mobile-scanner-peer-coordinator.ts";
import { routePeerReadyWork } from "./mobile-scanner-peer-readiness.ts";

test("pre-ready capture and photo work is rejected without delivery", async () => {
  const delivered = [];
  const rejected = [];

  for (const work of ["capture_result", "photo_transfer"]) {
    const result = await routePeerReadyWork({
      peerReady: false,
      deliver: () => delivered.push(work),
      reject: () => rejected.push(work),
    });
    assert.equal(result, "rejected");
  }

  assert.deepEqual(delivered, []);
  assert.deepEqual(rejected, ["capture_result", "photo_transfer"]);
});

test("post-ready capture and photo work is delivered normally", async () => {
  const delivered = [];
  const rejected = [];

  for (const work of ["capture_result", "photo_transfer"]) {
    const result = await routePeerReadyWork({
      peerReady: true,
      deliver: () => delivered.push(work),
      reject: () => rejected.push(work),
    });
    assert.equal(result, "delivered");
  }

  assert.deepEqual(delivered, ["capture_result", "photo_transfer"]);
  assert.deepEqual(rejected, []);
});

test("peer coordinator behaviorally gates both control and photo delivery", async () => {
  const delivered = [];
  const rejected = [];
  const closed = [];
  let coordinator;
  coordinator = new MobileScannerPeerCoordinator({
    closePeer: (peer) => closed.push(peer.id),
    deliverControl: (peer, rawData) =>
      coordinator.deliverReadyWork(peer, rawData, () => delivered.push(rawData)),
    deliverPhoto: (_peer, data) => delivered.push(data),
    isActive: () => true,
    sendInvalidState: (_peer, receivedType) => rejected.push(receivedType),
  });
  const peer = { id: "peer-1", ready: false, control: null };

  await coordinator.enqueueControl(peer, "capture_result");
  await coordinator.enqueuePhoto(peer, "photo_transfer");
  assert.deepEqual(delivered, []);
  assert.deepEqual(rejected, ["capture_result", "photo_transfer"]);
  assert.deepEqual(closed, ["peer-1", "peer-1"]);

  peer.ready = true;
  await coordinator.enqueueControl(peer, "capture_result");
  await coordinator.enqueuePhoto(peer, "photo_transfer");
  assert.deepEqual(delivered, ["capture_result", "photo_transfer"]);
});
