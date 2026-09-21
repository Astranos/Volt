import { type QueryCtx, type ActionCtx } from "../_generated/server";
import {
  type Principal,
  credentialArgs,
  requireDevicePrincipal,
  guestCredentialArgs,
  requireGuestPrincipal,
  type DeviceCredential,
  type GuestCredential,
  requireFullAppEntitlement,
  workspaceForUser,
  sha256Hex,
} from "./identity";
import { ConvexError, v, type ObjectType } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { type Doc } from "../_generated/dataModel";

export const PRESIGN_TTL_SECONDS = 5 * 60;

async function photoManifestForPrincipal(
  ctx: QueryCtx,
  principal: Principal,
  batchId: string,
) {
    const { workspace, sourceDeviceId } = principal;
    const batch = await ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", batchId),
      )
      .unique();
    if (!batch || batch.status !== "uploading" || batch.sourceDeviceId !== sourceDeviceId) {
      throw new ConvexError("Uploading batch not found");
    }
    const results = await ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", batchId),
      )
      .take(500);
    return results
      .filter((item) => item.kind === "photo" && item.objectKey)
      .map((item) => ({ objectKey: item.objectKey as string, byteCount: item.byteCount }));
}

export const photoManifestForFinalizeArgs = { ...credentialArgs, batchId: v.string() };
export const photoManifestForFinalizeHandler = async (ctx: QueryCtx, args: ObjectType<typeof photoManifestForFinalizeArgs>) => {
    return photoManifestForPrincipal(ctx, await requireDevicePrincipal(ctx, args), args.batchId);
  };

export const guestPhotoManifestForFinalizeArgs = { ...guestCredentialArgs, batchId: v.string() };
export const guestPhotoManifestForFinalizeHandler = async (ctx: QueryCtx, args: ObjectType<typeof guestPhotoManifestForFinalizeArgs>) => {
    return photoManifestForPrincipal(ctx, await requireGuestPrincipal(ctx, args), args.batchId);
  };

const photoManifestForFinalizeRef = makeFunctionReference<
  "query",
  DeviceCredential & { batchId: string },
  Array<{ objectKey: string; byteCount: number }>
>("cloudWorkspace:photoManifestForFinalize");

const markBatchReadyRef = makeFunctionReference<
  "mutation",
  DeviceCredential & { batchId: string },
  { idempotent: boolean }
>("cloudWorkspace:markBatchReady");

const guestPhotoManifestForFinalizeRef = makeFunctionReference<
  "query",
  GuestCredential & { batchId: string },
  Array<{ objectKey: string; byteCount: number }>
>("cloudWorkspace:guestPhotoManifestForFinalize");

const markGuestBatchReadyRef = makeFunctionReference<
  "mutation",
  GuestCredential & { batchId: string },
  { idempotent: boolean }
>("cloudWorkspace:markGuestBatchReady");

async function verifyUploadedPhotos(photos: Array<{ objectKey: string; byteCount: number }>) {
  for (const photo of photos) {
    const presigned = await presignR2("HEAD", photo.objectKey);
    const response = await fetch(presigned.url, { method: "HEAD" });
    const length = Number(response.headers.get("content-length"));
    if (!response.ok || !Number.isFinite(length) || length !== photo.byteCount) {
      throw new ConvexError("R2 photo verification failed");
    }
  }
}

export const finalizeBatchUploadsArgs = { ...credentialArgs, batchId: v.string() };
export const finalizeBatchUploadsHandler = async (ctx: ActionCtx, args: ObjectType<typeof finalizeBatchUploadsArgs>) => {
    const photos = await ctx.runQuery(photoManifestForFinalizeRef, args);
    await verifyUploadedPhotos(photos);
    return ctx.runMutation(markBatchReadyRef, args);
  };

export const finalizeGuestBatchUploadsArgs = { ...guestCredentialArgs, batchId: v.string() };
export const finalizeGuestBatchUploadsHandler = async (ctx: ActionCtx, args: ObjectType<typeof finalizeGuestBatchUploadsArgs>) => {
    const photos = await ctx.runQuery(guestPhotoManifestForFinalizeRef, args);
    await verifyUploadedPhotos(photos);
    return ctx.runMutation(markGuestBatchReadyRef, args);
  };

type PresignAuthorization = {
  objectKey: string;
  contentType?: string;
  checksum?: string;
};

export const authorizePhotoAccessArgs = {
    deviceId: v.optional(v.string()),
    deviceSecret: v.optional(v.string()),
    guestCloudGrant: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
    batchId: v.string(),
    resultId: v.string(),
    operation: v.union(v.literal("put"), v.literal("get")),
  };
export const authorizePhotoAccessHandler = async (ctx: QueryCtx, args: ObjectType<typeof authorizePhotoAccessArgs>): Promise<PresignAuthorization> => {
    let workspace: Doc<"workspaces"> | null = null;
    let sourceDeviceId: string | undefined;
    if (args.clerkUserId) {
      await requireFullAppEntitlement(ctx, args.clerkUserId);
      workspace = await workspaceForUser(ctx, args.clerkUserId);
    }
    else if (args.guestCloudGrant) {
      const principal = await requireGuestPrincipal(ctx, { guestCloudGrant: args.guestCloudGrant });
      workspace = principal.workspace;
      sourceDeviceId = principal.sourceDeviceId;
    }
    else if (args.deviceId && args.deviceSecret) {
      const principal = await requireDevicePrincipal(ctx, {
        deviceId: args.deviceId,
        deviceSecret: args.deviceSecret,
      });
      workspace = principal.workspace;
      sourceDeviceId = principal.sourceDeviceId;
    }
    if (!workspace) throw new ConvexError("Authentication required");
    const batch = await ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .unique();
    const result = await ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_resultId", (q) =>
        q.eq("workspaceId", workspace._id).eq("resultId", args.resultId),
      )
      .unique();
    if (!batch || !result || result.batchId !== args.batchId || result.kind !== "photo" || !result.objectKey) {
      throw new ConvexError("Photo not found");
    }
    if (args.operation === "put" && batch.status !== "uploading") {
      throw new ConvexError("Photo upload is no longer allowed");
    }
    if (args.operation === "put" && sourceDeviceId && batch.sourceDeviceId !== sourceDeviceId) {
      throw new ConvexError("Photo belongs to another source");
    }
    if (args.operation === "get" && batch.status !== "ready") {
      throw new ConvexError("Photo is not ready");
    }
    return {
      objectKey: result.objectKey,
      ...(result.contentType ? { contentType: result.contentType } : {}),
      ...(result.checksum ? { checksum: result.checksum } : {}),
    };
  };

const authorizePhotoAccessRef = makeFunctionReference<
  "query",
  {
    deviceId?: string;
    deviceSecret?: string;
    guestCloudGrant?: string;
    clerkUserId?: string;
    batchId: string;
    resultId: string;
    operation: "put" | "get";
  },
  PresignAuthorization
>("cloudWorkspace:authorizePhotoAccess");

export const createPhotoUploadUrlArgs = { ...credentialArgs, batchId: v.string(), resultId: v.string() };
export const createPhotoUploadUrlHandler = async (ctx: ActionCtx, args: ObjectType<typeof createPhotoUploadUrlArgs>) => {
    const photo = await ctx.runQuery(authorizePhotoAccessRef, { ...args, operation: "put" });
    return presignR2("PUT", photo.objectKey, photo.contentType);
  };

export const createGuestPhotoUploadUrlArgs = { ...guestCredentialArgs, batchId: v.string(), resultId: v.string() };
export const createGuestPhotoUploadUrlHandler = async (ctx: ActionCtx, args: ObjectType<typeof createGuestPhotoUploadUrlArgs>) => {
    const photo = await ctx.runQuery(authorizePhotoAccessRef, { ...args, operation: "put" });
    return presignR2("PUT", photo.objectKey, photo.contentType);
  };

export const createPhotoDownloadUrlArgs = {
    deviceId: v.optional(v.string()),
    deviceSecret: v.optional(v.string()),
    batchId: v.string(),
    resultId: v.string(),
  };
export const createPhotoDownloadUrlHandler = async (ctx: ActionCtx, args: ObjectType<typeof createPhotoDownloadUrlArgs>) => {
    const identity = await ctx.auth.getUserIdentity();
    const photo = await ctx.runQuery(authorizePhotoAccessRef, {
      ...args,
      ...(identity ? { clerkUserId: identity.subject } : {}),
      operation: "get",
    });
    return presignR2("GET", photo.objectKey);
  };

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new ConvexError(`${name} is not configured`);
  return value;
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function hmac(key: Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", Uint8Array.from(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)));
}

export async function presignR2(method: "PUT" | "GET" | "HEAD", objectKey: string, contentType?: string) {
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  const bucket = requiredEnv("R2_BUCKET");
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const credential = `${accessKeyId}/${scope}`;
  const canonicalUri = `/${encodeURIComponent(bucket)}/${encodePath(objectKey)}`;
  const queryParts = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(PRESIGN_TTL_SECONDS)],
    ["X-Amz-SignedHeaders", "host"],
  ] as const;
  const canonicalQuery = queryParts
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), date);
  const kRegion = await hmac(kDate, "auto");
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = Array.from(await hmac(kSigning, stringToSign), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    url: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    method,
    expiresAt: now.getTime() + PRESIGN_TTL_SECONDS * 1000,
    headers: method === "PUT" && contentType ? { "Content-Type": contentType } : {},
  };
}
