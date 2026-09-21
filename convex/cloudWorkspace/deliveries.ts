import {
  credentialArgs,
  requireDevicePrincipal,
  requireOrCreateAuthenticatedWorkspace,
  type Principal,
  guestCredentialArgs,
  requireGuestPrincipal,
  requireAuthenticatedWorkspace,
} from "./identity";
import { v, ConvexError, type ObjectType } from "convex/values";
import { type MutationCtx, type QueryCtx } from "../_generated/server";

export const CURSOR_DELIVERY_TTL_MS = 120 * 1000;

type CursorDeliveryInput = {
  deliveryId: string;
  resultId: string;
  targetDeviceId: string;
  kind: "barcode" | "text";
  text: string;
  format?: string;
  clientCreatedAt: number;
};

// cursorDeliveryStatus synthesizes a pending-and-past-expiresAt delivery as
// failed/expired without writing anything, so (like presence) a Convex
// subscriber never observes the flip until some other write touches the row.
// This sweep performs that write explicitly, using the state index so cost
// stays bounded by the pending set rather than the full (unbounded, never
// pruned) cursorDeliveries table.
export const sweepExpiredCursorDeliveriesArgs = {};
export const sweepExpiredCursorDeliveriesHandler = async (ctx: MutationCtx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("cursorDeliveries")
      .withIndex("by_state", (q) => q.eq("state", "pending"))
      .collect();
    for (const delivery of pending) {
      if (delivery.expiresAt <= now) {
        await ctx.db.patch(delivery._id, {
          state: "failed",
          errorCode: "expired",
          updatedAt: now,
        });
      }
    }
  };

export const queueDeliveryArgs = { ...credentialArgs, batchId: v.string(), targetDeviceId: v.string() };
export const queueDeliveryHandler = async (ctx: MutationCtx, args: ObjectType<typeof queueDeliveryArgs>) => {
    const { workspace } = await requireDevicePrincipal(ctx, args);
    const batch = await ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .unique();
    const target = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.targetDeviceId))
      .unique();
    if (!batch || batch.status !== "ready") throw new ConvexError("Ready batch not found");
    if (!target || target.workspaceId !== workspace._id || target.revokedAt || target.kind !== "chrome") {
      throw new ConvexError("Target computer not found");
    }
    const existing = (await ctx.db
      .query("resultDeliveries")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .collect()).find((item) => item.targetDeviceId === target.deviceId);
    if (existing) return { deliveryId: existing._id, idempotent: true };
    const deliveryId = await ctx.db.insert("resultDeliveries", {
      workspaceId: workspace._id,
      batchId: args.batchId,
      targetDeviceId: target.deviceId,
      state: "pending",
      attempts: 0,
      updatedAt: Date.now(),
    });
    return { deliveryId, idempotent: false };
  };

export const acknowledgeDeliveryArgs = {
    ...credentialArgs,
    batchId: v.string(),
    state: v.union(v.literal("delivered"), v.literal("failed")),
    errorCode: v.optional(v.string()),
  };
export const acknowledgeDeliveryHandler = async (ctx: MutationCtx, args: ObjectType<typeof acknowledgeDeliveryArgs>) => {
    const { workspace, device } = await requireDevicePrincipal(ctx, args);
    if (!device || device.kind !== "chrome") throw new ConvexError("Computer credential required");
    const delivery = (await ctx.db
      .query("resultDeliveries")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .collect()).find((item) => item.targetDeviceId === device.deviceId);
    if (!delivery) throw new ConvexError("Delivery not found");
    const now = Date.now();
    await ctx.db.patch(delivery._id, {
      state: args.state,
      attempts: delivery.attempts + 1,
      lastAttemptAt: now,
      ...(args.state === "delivered" ? { deliveredAt: now, errorCode: undefined } : { errorCode: args.errorCode }),
      updatedAt: now,
    });
    return { state: args.state };
  };

export const acknowledgeDeliveryAsComputerArgs = {
    installationId: v.string(),
    batchId: v.string(),
    state: v.union(v.literal("delivered"), v.literal("failed")),
    errorCode: v.optional(v.string()),
  };
export const acknowledgeDeliveryAsComputerHandler = async (ctx: MutationCtx, args: ObjectType<typeof acknowledgeDeliveryAsComputerArgs>) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const computer = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.installationId))
      .unique();
    if (!computer || computer.workspaceId !== workspace._id || computer.kind !== "chrome" || computer.revokedAt) {
      throw new ConvexError("Registered computer not found");
    }
    const delivery = (await ctx.db
      .query("resultDeliveries")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .collect()).find((item) => item.targetDeviceId === computer.deviceId);
    if (!delivery) throw new ConvexError("Delivery not found");
    const now = Date.now();
    await ctx.db.patch(delivery._id, {
      state: args.state,
      attempts: delivery.attempts + 1,
      lastAttemptAt: now,
      ...(args.state === "delivered" ? { deliveredAt: now, errorCode: undefined } : { errorCode: args.errorCode }),
      updatedAt: now,
    });
    return { state: args.state };
  };

async function queueCursorDeliveryForPrincipal(
  ctx: MutationCtx,
  principal: Principal,
  args: CursorDeliveryInput,
) {
    const { workspace, sourceDeviceId } = principal;
    const existing = await ctx.db
      .query("cursorDeliveries")
      .withIndex("by_workspaceId_and_deliveryId", (q) =>
        q.eq("workspaceId", workspace._id).eq("deliveryId", args.deliveryId),
      )
      .unique();
    if (existing) {
      if (
        existing.sourceDeviceId !== sourceDeviceId
        || existing.resultId !== args.resultId
        || existing.targetDeviceId !== args.targetDeviceId
        || existing.kind !== args.kind
        || existing.text !== args.text
        || existing.format !== args.format
        || existing.clientCreatedAt !== args.clientCreatedAt
      ) {
        throw new ConvexError("Delivery id conflicts with an existing delivery");
      }
      return { deliveryId: existing.deliveryId, idempotent: true, state: existing.state };
    }

    const result = await ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_resultId", (q) =>
        q.eq("workspaceId", workspace._id).eq("resultId", args.resultId),
      )
      .unique();
    if (
      !result
      || result.sourceDeviceId !== sourceDeviceId
      || result.deletedAt !== undefined
      || (result.kind !== "barcode" && result.kind !== "text" && result.kind !== "dictation")
    ) {
      throw new ConvexError("Deliverable result not found");
    }
    const deliveryKind = result.kind === "dictation" ? "text" : result.kind;
    if (deliveryKind !== args.kind || result.text !== args.text || result.format !== args.format) {
      throw new ConvexError("Delivery payload does not match the stored result");
    }

    const target = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.targetDeviceId))
      .unique();
    if (!target || target.workspaceId !== workspace._id || target.revokedAt || target.kind !== "chrome") {
      throw new ConvexError("Target computer not found");
    }

    const now = Date.now();
    await ctx.db.insert("cursorDeliveries", {
      workspaceId: workspace._id,
      deliveryId: args.deliveryId,
      resultId: args.resultId,
      sourceDeviceId,
      targetDeviceId: target.deviceId,
      kind: args.kind,
      text: args.text,
      ...(args.format !== undefined ? { format: args.format } : {}),
      state: "pending",
      attempts: 0,
      clientCreatedAt: args.clientCreatedAt,
      expiresAt: Math.min(
        args.clientCreatedAt + CURSOR_DELIVERY_TTL_MS,
        now + CURSOR_DELIVERY_TTL_MS,
      ),
      createdAt: now,
      updatedAt: now,
    });
    return { deliveryId: args.deliveryId, idempotent: false, state: "pending" as const };
}

const cursorDeliveryArgs = {
  deliveryId: v.string(),
  resultId: v.string(),
  targetDeviceId: v.string(),
  kind: v.union(v.literal("barcode"), v.literal("text")),
  text: v.string(),
  format: v.optional(v.string()),
  clientCreatedAt: v.number(),
};

export const queueCursorDeliveryArgs = { ...credentialArgs, ...cursorDeliveryArgs };
export const queueCursorDeliveryHandler = async (ctx: MutationCtx, args: ObjectType<typeof queueCursorDeliveryArgs>) => {
    return queueCursorDeliveryForPrincipal(ctx, await requireDevicePrincipal(ctx, args), args);
  };

export const queueGuestCursorDeliveryArgs = { ...guestCredentialArgs, ...cursorDeliveryArgs };
export const queueGuestCursorDeliveryHandler = async (ctx: MutationCtx, args: ObjectType<typeof queueGuestCursorDeliveryArgs>) => {
    const principal = await requireGuestPrincipal(ctx, args);
    if (principal.guestGrant) {
      await ctx.db.patch(principal.guestGrant._id, { lastUsedAt: Date.now() });
    }
    return queueCursorDeliveryForPrincipal(ctx, principal, args);
  };

export const pendingCursorDeliveriesArgs = { installationId: v.string() };
export const pendingCursorDeliveriesHandler = async (ctx: QueryCtx, args: ObjectType<typeof pendingCursorDeliveriesArgs>) => {
    const workspace = await requireAuthenticatedWorkspace(ctx);
    const computer = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.installationId))
      .unique();
    if (!computer || computer.workspaceId !== workspace._id || computer.kind !== "chrome" || computer.revokedAt) {
      return [];
    }
    const deliveries = await ctx.db
      .query("cursorDeliveries")
      .withIndex("by_targetDeviceId_and_state", (q) =>
        q.eq("targetDeviceId", computer.deviceId).eq("state", "pending"),
      )
      .collect();
    return deliveries.filter((delivery) =>
      delivery.workspaceId === workspace._id
    ).map((delivery) => ({
      deliveryId: delivery.deliveryId,
      resultId: delivery.resultId,
      sourceDeviceId: delivery.sourceDeviceId,
      targetDeviceId: delivery.targetDeviceId,
      kind: delivery.kind,
      text: delivery.text,
      ...(delivery.format !== undefined ? { format: delivery.format } : {}),
      state: delivery.state,
      attempts: delivery.attempts,
      clientCreatedAt: delivery.clientCreatedAt,
      expiresAt: delivery.expiresAt,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
    }));
  };

export const acknowledgeCursorDeliveryArgs = {
    installationId: v.string(),
    deliveryId: v.string(),
    state: v.union(v.literal("delivered"), v.literal("failed")),
    errorCode: v.optional(v.string()),
  };
export const acknowledgeCursorDeliveryHandler = async (ctx: MutationCtx, args: ObjectType<typeof acknowledgeCursorDeliveryArgs>) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const computer = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.installationId))
      .unique();
    if (!computer || computer.workspaceId !== workspace._id || computer.kind !== "chrome" || computer.revokedAt) {
      throw new ConvexError("Registered computer not found");
    }
    const delivery = await ctx.db
      .query("cursorDeliveries")
      .withIndex("by_workspaceId_and_deliveryId", (q) =>
        q.eq("workspaceId", workspace._id).eq("deliveryId", args.deliveryId),
      )
      .unique();
    if (!delivery || delivery.targetDeviceId !== computer.deviceId) {
      throw new ConvexError("Cursor delivery not found");
    }
    if (delivery.state !== "pending") {
      return { state: delivery.state, idempotent: true, attempts: delivery.attempts };
    }

    const now = Date.now();
    const attempts = delivery.attempts + 1;
    // A delivered acknowledgement that arrives after expiry is recorded as
    // failed/expired so a soft-expired status report can never later flip to
    // delivered (the phone already showed "failed").
    const expired = args.state === "delivered" && delivery.expiresAt <= now;
    const effectiveState = expired ? "failed" : args.state;
    await ctx.db.patch(delivery._id, {
      state: effectiveState,
      attempts,
      ...(effectiveState === "delivered"
        ? { deliveredAt: now, errorCode: undefined }
        : { errorCode: expired ? "expired" : args.errorCode }),
      updatedAt: now,
    });
    return { state: effectiveState, idempotent: false, attempts };
  };

const CURSOR_DELIVERY_STATUS_LIMIT = 100;

export const cursorDeliveryStatusArgs = { ...credentialArgs, deliveryIds: v.array(v.string()) };
export const cursorDeliveryStatusHandler = async (ctx: QueryCtx, args: ObjectType<typeof cursorDeliveryStatusArgs>) => {
    const { workspace, device } = await requireDevicePrincipal(ctx, args);
    if (!device) throw new ConvexError("Device required");
    const deliveryIds = [...new Set(args.deliveryIds)].slice(0, CURSOR_DELIVERY_STATUS_LIMIT);
    const now = Date.now();
    const statuses: Array<{
      deliveryId: string;
      state: "pending" | "delivered" | "failed";
      errorCode?: string;
      deliveredAt?: number;
    }> = [];
    for (const deliveryId of deliveryIds) {
      const delivery = await ctx.db
        .query("cursorDeliveries")
        .withIndex("by_workspaceId_and_deliveryId", (q) =>
          q.eq("workspaceId", workspace._id).eq("deliveryId", deliveryId),
        )
        .unique();
      if (!delivery || delivery.sourceDeviceId !== device.deviceId) continue;
      if (delivery.state === "pending" && delivery.expiresAt <= now) {
        statuses.push({ deliveryId, state: "failed", errorCode: "expired" });
        continue;
      }
      statuses.push({
        deliveryId,
        state: delivery.state,
        ...(delivery.errorCode !== undefined ? { errorCode: delivery.errorCode } : {}),
        ...(delivery.deliveredAt !== undefined ? { deliveredAt: delivery.deliveredAt } : {}),
      });
    }
    return { statuses };
  };
