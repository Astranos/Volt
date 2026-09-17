import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { productFields, publicRequest, receipt, staffStatus } from "./kioskRequestValidators";

const productValidator = v.object(productFields);
const HOUR = 3_600_000;

function authorize(secret: string, storeSlug: string) {
  const configured = process.env.KIOSK_REQUEST_SECRET;
  if (!configured || configured.length < 32 || secret !== configured) throw new ConvexError({ code: "UNAUTHORIZED" });
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(storeSlug)) throw new ConvexError({ code: "INVALID_INPUT" });
}

function validUrl(value: string, hostname: string) {
  try {
    const url = new URL(value);
    return value.length <= 2048 && url.protocol === "https:" && url.hostname === hostname && !url.port && !url.username && !url.password;
  } catch { return false; }
}

function validateProduct(product: Infer<typeof productValidator>, storeSlug: string) {
  if (!/^\d{1,30}$/.test(product.productId) || !/^\d{1,30}$/.test(product.variantId)
    || !product.title.trim() || product.title.length > 500 || product.variantTitle.length > 300
    || (product.sku !== null && product.sku.length > 200)
    || !Number.isSafeInteger(product.priceCents) || product.priceCents < 0
    || !validUrl(product.productUrl, `${storeSlug}.paymore.com`)
    || (product.imageUrl !== null && !validUrl(product.imageUrl, "cdn.shopify.com"))) {
    throw new ConvexError({ code: "INVALID_INPUT" });
  }
}

function toPublic(row: Doc<"kioskRequests">) {
  const { _id, _creationTime, requestKey, clientHash, ...fields } = row;
  return { id: _id, ...fields };
}

async function activeRows(ctx: QueryCtx, storeSlug: string, now: number) {
  const rows = await Promise.all((["waiting", "found"] as const).map(status => ctx.db.query("kioskRequests")
    .withIndex("by_storeSlug_and_status_and_expiresAt", q => q.eq("storeSlug", storeSlug).eq("status", status).gt("expiresAt", now)).take(100)));
  return rows.flat().sort((a, b) => a.createdAt - b.createdAt).slice(0, 100);
}

export const enqueue = mutation({
  args: { secret: v.string(), storeSlug: v.string(), requestKey: v.string(), clientHash: v.string(), product: productValidator },
  returns: receipt,
  handler: async (ctx, args): Promise<Infer<typeof receipt>> => {
    authorize(args.secret, args.storeSlug);
    validateProduct(args.product, args.storeSlug);
    if (!/^[0-9a-f-]{36}:\d{1,30}$/i.test(args.requestKey) || !/^[0-9a-f]{64}$/.test(args.clientHash)
      || args.requestKey.split(":")[1] !== args.product.variantId) throw new ConvexError({ code: "INVALID_INPUT" });
    const now = Date.now();
    const existing = await ctx.db.query("kioskRequests").withIndex("by_storeSlug_and_requestKey", q => q.eq("storeSlug", args.storeSlug).eq("requestKey", args.requestKey)).unique();
    if (existing) {
      if (existing.expiresAt <= now) throw new ConvexError({ code: "CONFLICT" });
      if (existing.productId !== args.product.productId || existing.variantId !== args.product.variantId || existing.clientHash !== args.clientHash) throw new ConvexError({ code: "CONFLICT" });
      return { id: existing._id, status: existing.status, createdAt: existing.createdAt, expiresAt: existing.expiresAt };
    }
    const recent = await ctx.db.query("kioskRequests").withIndex("by_storeSlug_and_createdAt", q => q.eq("storeSlug", args.storeSlug).gt("createdAt", now - 60_000)).take(30);
    const visitorRecent = await ctx.db.query("kioskRequests").withIndex("by_storeSlug_and_clientHash_and_createdAt", q => q.eq("storeSlug", args.storeSlug).eq("clientHash", args.clientHash).gt("createdAt", now - 60_000)).take(5);
    if (recent.length >= 30 || visitorRecent.length >= 5) throw new ConvexError({ code: "RATE_LIMITED" });
    if ((await activeRows(ctx, args.storeSlug, now)).length >= 100) throw new ConvexError({ code: "QUEUE_FULL" });
    const expiresAt = now + HOUR;
    const id = await ctx.db.insert("kioskRequests", { ...args.product, storeSlug: args.storeSlug, requestKey: args.requestKey, clientHash: args.clientHash, status: "waiting", createdAt: now, updatedAt: now, expiresAt });
    await ctx.scheduler.runAt(expiresAt, internal.kioskRequests.expire, { id });
    return { id, status: "waiting" as const, createdAt: now, expiresAt };
  },
});

export const list = query({
  args: { secret: v.string(), storeSlug: v.string(), now: v.number() },
  returns: v.object({ requests: v.array(publicRequest), serverNow: v.number() }),
  handler: async (ctx, args) => {
    authorize(args.secret, args.storeSlug);
    if (!Number.isSafeInteger(args.now) || args.now < 0) throw new ConvexError({ code: "INVALID_INPUT" });
    const serverNow = args.now;
    return { requests: (await activeRows(ctx, args.storeSlug, serverNow)).map(toPublic), serverNow };
  },
});

export const setStatus = mutation({
  args: { secret: v.string(), storeSlug: v.string(), id: v.id("kioskRequests"), status: staffStatus },
  returns: v.union(publicRequest, v.null()),
  handler: async (ctx, args) => {
    authorize(args.secret, args.storeSlug);
    const row = await ctx.db.get(args.id);
    const now = Date.now();
    if (!row || row.storeSlug !== args.storeSlug || row.expiresAt <= now) return null;
    if (row.status === args.status) return toPublic(row);
    if (row.status !== "waiting" && row.status !== "found") throw new ConvexError({ code: "CONFLICT" });
    await ctx.db.patch(args.id, { status: args.status, updatedAt: now });
    return toPublic({ ...row, status: args.status, updatedAt: now });
  },
});

export const expire = internalMutation({
  args: { id: v.id("kioskRequests") }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete(args.id);
    return null;
  },
});
