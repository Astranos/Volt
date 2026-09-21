import { convexTest } from "convex-test";

import { afterEach, describe, expect, test, vi } from "vitest";
import { CURSOR_DELIVERY_TTL_MS } from "./cloudWorkspace";
import schema from "./schema";
import {
  CursorDeliveryInput,
  acknowledgeCursorDelivery,
  bootstrapMobileDevice,
  cursorDeliveryStatus,
  grantFullAppAccess,
  modules,
  pendingCursorDeliveries,
  putBatch,
  queueCursorDelivery,
  registerComputer,
  restoreWorkspaceTestEnvironment,
  result,
  sweepExpiredCursorDeliveries,
} from "./cloudWorkspace.testSupport";

afterEach(restoreWorkspaceTestEnvironment);

describe("cloud scanner workspace deliveries", () => {

  test("reports cursor delivery status only for the calling device's own workspace deliveries", async () => {
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "status-owner");
    await grantFullAppAccess(t, "status-other-owner");
    const alice = t.withIdentity({ subject: "status-owner" });
    const bob = t.withIdentity({ subject: "status-other-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "status-phone",
      label: "Alice phone",
    });
    const otherPhone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "status-phone-2",
      label: "Alice second phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "status-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };

    await t.mutation(putBatch, {
      ...credential,
      batchId: "status-batch",
      clientCreatedAt: Date.now(),
      results: [result("delivered-result"), result("failed-result"), result("pending-result")],
    });
    for (const [deliveryId, resultId] of [
      ["delivered-delivery", "delivered-result"],
      ["failed-delivery", "failed-result"],
      ["pending-delivery", "pending-result"],
    ]) {
      await t.mutation(queueCursorDelivery, {
        ...credential,
        deliveryId,
        resultId,
        targetDeviceId: "status-chrome",
        kind: "text",
        text: resultId,
        clientCreatedAt: Date.now(),
      });
    }
    await alice.mutation(acknowledgeCursorDelivery, {
      installationId: "status-chrome",
      deliveryId: "delivered-delivery",
      state: "delivered",
    });
    await alice.mutation(acknowledgeCursorDelivery, {
      installationId: "status-chrome",
      deliveryId: "failed-delivery",
      state: "failed",
      errorCode: "no-editable-field",
    });

    // Another device in the same workspace queues its own delivery.
    const otherCredential = { deviceId: otherPhone.deviceId, deviceSecret: otherPhone.deviceSecret };
    await t.mutation(putBatch, {
      ...otherCredential,
      batchId: "status-other-device-batch",
      clientCreatedAt: Date.now(),
      results: [result("other-device-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...otherCredential,
      deliveryId: "other-device-delivery",
      resultId: "other-device-result",
      targetDeviceId: "status-chrome",
      kind: "text",
      text: "other-device-result",
      clientCreatedAt: Date.now(),
    });

    // Another workspace queues a delivery whose id collides by name only.
    const bobPhone = await bob.mutation(bootstrapMobileDevice, {
      installationId: "status-bob-phone",
      label: "Bob phone",
    });
    await bob.mutation(registerComputer, {
      installationId: "status-bob-chrome",
      label: "Bob Chrome",
      capabilities: ["cursor-insertion"],
    });
    const bobCredential = { deviceId: bobPhone.deviceId, deviceSecret: bobPhone.deviceSecret };
    await t.mutation(putBatch, {
      ...bobCredential,
      batchId: "status-bob-batch",
      clientCreatedAt: Date.now(),
      results: [result("delivered-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...bobCredential,
      deliveryId: "delivered-delivery",
      resultId: "delivered-result",
      targetDeviceId: "status-bob-chrome",
      kind: "text",
      text: "delivered-result",
      clientCreatedAt: Date.now(),
    });

    const { statuses } = await t.query(cursorDeliveryStatus, {
      ...credential,
      deliveryIds: [
        "delivered-delivery",
        "failed-delivery",
        "pending-delivery",
        "other-device-delivery",
        "unknown-delivery",
      ],
    });
    const byId = Object.fromEntries(statuses.map((status) => [status.deliveryId, status]));
    expect(statuses).toHaveLength(3);
    expect(byId["delivered-delivery"]).toMatchObject({ state: "delivered" });
    expect(byId["delivered-delivery"].deliveredAt).toBeTypeOf("number");
    expect(byId["delivered-delivery"].errorCode).toBeUndefined();
    expect(byId["failed-delivery"]).toMatchObject({ state: "failed", errorCode: "no-editable-field" });
    expect(byId["pending-delivery"]).toMatchObject({ state: "pending" });
    expect(byId["other-device-delivery"]).toBeUndefined();
    expect(byId["unknown-delivery"]).toBeUndefined();
  });

  test("marks an expired but still-pending cursor delivery as failed with an expired error code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "expiry-owner");
    const alice = t.withIdentity({ subject: "expiry-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "expiry-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "expiry-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "expiry-batch",
      clientCreatedAt: Date.now(),
      results: [result("expiry-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "expiry-delivery",
      resultId: "expiry-result",
      targetDeviceId: "expiry-chrome",
      kind: "text",
      text: "expiry-result",
      clientCreatedAt: Date.now(),
    });

    vi.advanceTimersByTime(CURSOR_DELIVERY_TTL_MS + 1);
    const { statuses } = await t.query(cursorDeliveryStatus, {
      ...credential,
      deliveryIds: ["expiry-delivery"],
    });
    expect(statuses).toEqual([{ deliveryId: "expiry-delivery", state: "failed", errorCode: "expired" }]);
  });

  test("records a delivered acknowledgement after expiry as failed/expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "ack-expiry-owner");
    const alice = t.withIdentity({ subject: "ack-expiry-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "ack-expiry-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "ack-expiry-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "ack-expiry-batch",
      clientCreatedAt: Date.now(),
      results: [result("ack-expiry-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "ack-expiry-delivery",
      resultId: "ack-expiry-result",
      targetDeviceId: "ack-expiry-chrome",
      kind: "text",
      text: "ack-expiry-result",
      clientCreatedAt: Date.now(),
    });

    // The extension delivers after the soft-expiry window has already passed.
    vi.advanceTimersByTime(CURSOR_DELIVERY_TTL_MS + 1);
    const ack = await alice.mutation(acknowledgeCursorDelivery, {
      installationId: "ack-expiry-chrome",
      deliveryId: "ack-expiry-delivery",
      state: "delivered",
    });
    expect(ack).toMatchObject({ state: "failed", idempotent: false });

    const stored = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(stored).toMatchObject({ state: "failed", errorCode: "expired" });
    expect(stored?.deliveredAt).toBeUndefined();

    // The phone's status endpoint now agrees: the delivery can never be delivered.
    const { statuses } = await t.query(cursorDeliveryStatus, {
      ...credential,
      deliveryIds: ["ack-expiry-delivery"],
    });
    expect(statuses).toEqual([{ deliveryId: "ack-expiry-delivery", state: "failed", errorCode: "expired" }]);
  });

  test("queues cursor deliveries idempotently by workspace and client delivery id", async () => {
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "delivery-queue-owner");
    const signedIn = t.withIdentity({ subject: "delivery-queue-owner" });
    const phone = await signedIn.mutation(bootstrapMobileDevice, {
      installationId: "delivery-phone",
      label: "Delivery phone",
    });
    await signedIn.mutation(registerComputer, {
      installationId: "delivery-chrome",
      label: "Delivery Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "delivery-batch",
      clientCreatedAt: 1,
      results: [result("delivery-result")],
    });
    const input: CursorDeliveryInput = {
      ...credential,
      deliveryId: "cursor-delivery-id",
      resultId: "delivery-result",
      targetDeviceId: "delivery-chrome",
      kind: "text",
      text: "delivery-result",
      clientCreatedAt: 1_000,
    };

    expect(await t.mutation(queueCursorDelivery, input)).toEqual({
      deliveryId: "cursor-delivery-id",
      idempotent: false,
      state: "pending",
    });
    expect(await t.mutation(queueCursorDelivery, input)).toEqual({
      deliveryId: "cursor-delivery-id",
      idempotent: true,
      state: "pending",
    });
    const stored = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(stored).toMatchObject({
      deliveryId: "cursor-delivery-id",
      resultId: "delivery-result",
      expiresAt: 1_000 + CURSOR_DELIVERY_TTL_MS,
      attempts: 0,
    });
  });

  test("caps future-dated cursor delivery expiry at one server-side TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "future-delivery-owner");
    const signedIn = t.withIdentity({ subject: "future-delivery-owner" });
    const phone = await signedIn.mutation(bootstrapMobileDevice, {
      installationId: "future-delivery-phone",
      label: "Future delivery phone",
    });
    await signedIn.mutation(registerComputer, {
      installationId: "future-delivery-chrome",
      label: "Future delivery Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "future-delivery-batch",
      clientCreatedAt: Date.now(),
      results: [result("future-delivery-result")],
    });
    const serverNow = Date.now();
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "future-delivery",
      resultId: "future-delivery-result",
      targetDeviceId: "future-delivery-chrome",
      kind: "text",
      text: "future-delivery-result",
      clientCreatedAt: serverNow + 365 * 24 * 60 * 60 * 1000,
    });

    const stored = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(stored?.expiresAt).toBe(serverNow + CURSOR_DELIVERY_TTL_MS);
  });

  test("scopes pending cursor deliveries to the authenticated registered computer", async () => {
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "pending-alice");
    await grantFullAppAccess(t, "pending-bob");
    const alice = t.withIdentity({ subject: "pending-alice" });
    const bob = t.withIdentity({ subject: "pending-bob" });
    const alicePhone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "pending-alice-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "pending-alice-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    await bob.mutation(registerComputer, {
      installationId: "pending-bob-chrome",
      label: "Bob Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: alicePhone.deviceId, deviceSecret: alicePhone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "pending-batch",
      clientCreatedAt: Date.now(),
      results: [result("pending-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "pending-delivery",
      resultId: "pending-result",
      targetDeviceId: "pending-alice-chrome",
      kind: "text",
      text: "pending-result",
      clientCreatedAt: Date.now(),
    });

    expect(await alice.query(pendingCursorDeliveries, {
      installationId: "pending-alice-chrome",
    })).toHaveLength(1);
    expect(await bob.query(pendingCursorDeliveries, {
      installationId: "pending-bob-chrome",
    })).toEqual([]);
    expect(await bob.query(pendingCursorDeliveries, {
      installationId: "pending-alice-chrome",
    })).toEqual([]);
  });

  test("guards cursor delivery acknowledgement transitions and keeps terminal states immutable", async () => {
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "cursor-ack-owner");
    const signedIn = t.withIdentity({ subject: "cursor-ack-owner" });
    const phone = await signedIn.mutation(bootstrapMobileDevice, {
      installationId: "cursor-ack-phone",
      label: "Ack phone",
    });
    await signedIn.mutation(registerComputer, {
      installationId: "cursor-ack-chrome",
      label: "Ack Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "cursor-ack-batch",
      clientCreatedAt: Date.now(),
      results: [result("delivered-result"), result("failed-result")],
    });
    for (const [deliveryId, resultId] of [
      ["delivered-delivery", "delivered-result"],
      ["failed-delivery", "failed-result"],
    ] as const) {
      await t.mutation(queueCursorDelivery, {
        ...credential,
        deliveryId,
        resultId,
        targetDeviceId: "cursor-ack-chrome",
        kind: "text",
        text: resultId,
        clientCreatedAt: Date.now(),
      });
    }

    expect(await signedIn.mutation(acknowledgeCursorDelivery, {
      installationId: "cursor-ack-chrome",
      deliveryId: "delivered-delivery",
      state: "delivered",
    })).toMatchObject({ state: "delivered", idempotent: false, attempts: 1 });
    expect(await signedIn.mutation(acknowledgeCursorDelivery, {
      installationId: "cursor-ack-chrome",
      deliveryId: "delivered-delivery",
      state: "failed",
      errorCode: "no-editable-field",
    })).toMatchObject({ state: "delivered", idempotent: true, attempts: 1 });
    expect(await signedIn.mutation(acknowledgeCursorDelivery, {
      installationId: "cursor-ack-chrome",
      deliveryId: "failed-delivery",
      state: "failed",
      errorCode: "no-editable-field",
    })).toMatchObject({ state: "failed", idempotent: false, attempts: 1 });
    expect(await signedIn.mutation(acknowledgeCursorDelivery, {
      installationId: "cursor-ack-chrome",
      deliveryId: "failed-delivery",
      state: "delivered",
    })).toMatchObject({ state: "failed", idempotent: true, attempts: 1 });
    const deliveries = await t.run((ctx) => ctx.db.query("cursorDeliveries").collect());
    expect(deliveries.find((item) => item.deliveryId === "delivered-delivery")).toMatchObject({
      state: "delivered",
      attempts: 1,
    });
    expect(deliveries.find((item) => item.deliveryId === "failed-delivery")).toMatchObject({
      state: "failed",
      attempts: 1,
      errorCode: "no-editable-field",
    });
  });

  test("returns expired cursor deliveries so the extension can fail them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "cursor-expiry-owner");
    const signedIn = t.withIdentity({ subject: "cursor-expiry-owner" });
    const phone = await signedIn.mutation(bootstrapMobileDevice, {
      installationId: "cursor-expiry-phone",
      label: "Expiry phone",
    });
    await signedIn.mutation(registerComputer, {
      installationId: "cursor-expiry-chrome",
      label: "Expiry Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "cursor-expiry-batch",
      clientCreatedAt: Date.now(),
      results: [result("expired-result"), result("current-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "expired-delivery",
      resultId: "expired-result",
      targetDeviceId: "cursor-expiry-chrome",
      kind: "text",
      text: "expired-result",
      clientCreatedAt: Date.now() - CURSOR_DELIVERY_TTL_MS,
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "current-delivery",
      resultId: "current-result",
      targetDeviceId: "cursor-expiry-chrome",
      kind: "text",
      text: "current-result",
      clientCreatedAt: Date.now(),
    });

    expect((await signedIn.query(pendingCursorDeliveries, {
      installationId: "cursor-expiry-chrome",
    })).map((delivery) => delivery.deliveryId)).toEqual([
      "expired-delivery",
      "current-delivery",
    ]);
  });

  test("sweeps an expired pending cursor delivery to failed/expired identically to synthesized status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "sweep-delivery-owner");
    const alice = t.withIdentity({ subject: "sweep-delivery-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "sweep-delivery-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "sweep-delivery-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "sweep-delivery-batch",
      clientCreatedAt: Date.now(),
      results: [result("sweep-delivery-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "sweep-delivery-delivery",
      resultId: "sweep-delivery-result",
      targetDeviceId: "sweep-delivery-chrome",
      kind: "text",
      text: "sweep-delivery-result",
      clientCreatedAt: Date.now(),
    });

    vi.advanceTimersByTime(CURSOR_DELIVERY_TTL_MS + 1);
    await t.mutation(sweepExpiredCursorDeliveries, {});

    const stored = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(stored).toMatchObject({ state: "failed", errorCode: "expired" });
    expect(stored?.deliveredAt).toBeUndefined();
    expect(stored?.attempts).toBe(0);

    // cursorDeliveryStatus reports the swept row exactly as it would have
    // synthesized it on the fly before the sweep ran.
    const { statuses } = await t.query(cursorDeliveryStatus, {
      ...credential,
      deliveryIds: ["sweep-delivery-delivery"],
    });
    expect(statuses).toEqual([
      { deliveryId: "sweep-delivery-delivery", state: "failed", errorCode: "expired" },
    ]);

    // A swept delivery must not resurface as pending for the extension.
    expect(await alice.query(pendingCursorDeliveries, {
      installationId: "sweep-delivery-chrome",
    })).toEqual([]);
  });

  test("leaves a non-expired pending cursor delivery untouched by the sweep", async () => {
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "sweep-delivery-owner-2");
    const alice = t.withIdentity({ subject: "sweep-delivery-owner-2" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "sweep-delivery-live-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "sweep-delivery-live-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "sweep-delivery-live-batch",
      clientCreatedAt: Date.now(),
      results: [result("sweep-delivery-live-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "sweep-delivery-live-delivery",
      resultId: "sweep-delivery-live-result",
      targetDeviceId: "sweep-delivery-live-chrome",
      kind: "text",
      text: "sweep-delivery-live-result",
      clientCreatedAt: Date.now(),
    });

    await t.mutation(sweepExpiredCursorDeliveries, {});

    const stored = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(stored).toMatchObject({ state: "pending" });
    expect(await alice.query(pendingCursorDeliveries, {
      installationId: "sweep-delivery-live-chrome",
    })).toHaveLength(1);
  });

  test("acknowledging a delivery the sweeper already expired does not throw", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "sweep-ack-race-owner");
    const alice = t.withIdentity({ subject: "sweep-ack-race-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "sweep-ack-race-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "sweep-ack-race-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "sweep-ack-race-batch",
      clientCreatedAt: Date.now(),
      results: [result("sweep-ack-race-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "sweep-ack-race-delivery",
      resultId: "sweep-ack-race-result",
      targetDeviceId: "sweep-ack-race-chrome",
      kind: "text",
      text: "sweep-ack-race-result",
      clientCreatedAt: Date.now(),
    });

    vi.advanceTimersByTime(CURSOR_DELIVERY_TTL_MS + 1);
    await t.mutation(sweepExpiredCursorDeliveries, {});

    // The extension was mid-flight delivering when the sweeper ran; its
    // acknowledgement lands on an already-swept row and must resolve
    // idempotently rather than throw.
    const ack = await alice.mutation(acknowledgeCursorDelivery, {
      installationId: "sweep-ack-race-chrome",
      deliveryId: "sweep-ack-race-delivery",
      state: "delivered",
    });
    expect(ack).toMatchObject({ state: "failed", idempotent: true });
  });
});
