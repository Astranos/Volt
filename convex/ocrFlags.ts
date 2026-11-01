import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { requireDevicePrincipal } from "./cloudWorkspace/identity";
import { presignR2 } from "./cloudWorkspace/photos";

// TestFlight-only "Flag" button in the iOS OCR review: the captured photo goes to R2 and the
// recognizer output is stored here so we can replay and improve serial/model/UPC parsing.

export const OCR_FLAG_MAX_PHOTO_BYTES = 6_000_000;
export const OCR_FLAG_MAX_PER_HOUR = 60;
const MAX_REGIONS = 400;
const MAX_REGION_TEXT = 500;
const MAX_SELECTED_TEXT = 4_000;

const regionValidator = v.object({
  text: v.string(),
  confidence: v.number(),
  isDeviceIdentifier: v.boolean(),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

export type OcrFlagRegion = {
  text: string;
  confidence: number;
  isDeviceIdentifier: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OcrFlagInput = {
  flagId: string;
  byteCount: number;
  selectedRawText: string;
  selectedCleanedText?: string;
  regions: OcrFlagRegion[];
  rawRegionTexts: string[];
  appVersion?: string;
  appBuild?: string;
  note?: string;
};

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.slice(0, maxLength) : undefined;
}

function regionFrom(value: unknown): OcrFlagRegion | null {
  const region = objectFrom(value);
  const text = typeof region.text === "string" ? region.text.slice(0, MAX_REGION_TEXT) : null;
  const confidence = finiteNumber(region.confidence);
  const x = finiteNumber(region.x);
  const y = finiteNumber(region.y);
  const width = finiteNumber(region.width);
  const height = finiteNumber(region.height);
  if (text === null || confidence === null || x === null || y === null || width === null || height === null) return null;
  return { text, confidence, isDeviceIdentifier: region.isDeviceIdentifier === true, x, y, width, height };
}

/** Validates the JSON body the iOS app posts to /api/mobile/ocr-flags. Returns null when malformed. */
export function ocrFlagInputFrom(body: unknown): OcrFlagInput | null {
  const payload = objectFrom(body);
  const flagId = typeof payload.flagId === "string" ? payload.flagId.trim().toLowerCase() : "";
  if (!/^[0-9a-f-]{36}$/.test(flagId)) return null;
  const byteCount = finiteNumber(payload.byteCount);
  if (byteCount === null || byteCount <= 0 || byteCount > OCR_FLAG_MAX_PHOTO_BYTES) return null;
  if (typeof payload.selectedRawText !== "string") return null;
  if (!Array.isArray(payload.regions) || payload.regions.length > MAX_REGIONS) return null;
  const regions = payload.regions.map(regionFrom);
  if (regions.some((region) => region === null)) return null;
  const rawRegionTexts = Array.isArray(payload.rawRegionTexts)
    ? payload.rawRegionTexts
      .filter((text): text is string => typeof text === "string")
      .slice(0, MAX_REGIONS)
      .map((text) => text.slice(0, MAX_REGION_TEXT))
    : [];
  return {
    flagId,
    byteCount,
    selectedRawText: payload.selectedRawText.slice(0, MAX_SELECTED_TEXT),
    selectedCleanedText: optionalString(payload.selectedCleanedText, MAX_SELECTED_TEXT),
    regions: regions as OcrFlagRegion[],
    rawRegionTexts,
    appVersion: optionalString(payload.appVersion, 40),
    appBuild: optionalString(payload.appBuild, 40),
    note: optionalString(payload.note, 1_000),
  };
}

export function ocrFlagObjectKey(workspaceId: string, flagId: string) {
  return `ocr-flags/${workspaceId}/${flagId}.jpg`;
}

const credentialArgs = { deviceId: v.string(), deviceSecret: v.string() };

export const createOcrFlagRecord = internalMutation({
  args: {
    ...credentialArgs,
    flagId: v.string(),
    byteCount: v.number(),
    selectedRawText: v.string(),
    selectedCleanedText: v.optional(v.string()),
    regions: v.array(regionValidator),
    rawRegionTexts: v.array(v.string()),
    appVersion: v.optional(v.string()),
    appBuild: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace, sourceDeviceId } = await requireDevicePrincipal(ctx, args);
    const existing = await ctx.db
      .query("ocrFlags")
      .withIndex("by_flagId", (q) => q.eq("flagId", args.flagId))
      .unique();
    if (existing) {
      if (existing.sourceDeviceId !== sourceDeviceId) throw new ConvexError("Flag belongs to another device");
      return { objectKey: existing.objectKey, contentType: existing.contentType };
    }

    const now = Date.now();
    const recent = await ctx.db
      .query("ocrFlags")
      .withIndex("by_sourceDeviceId_and_createdAt", (q) =>
        q.eq("sourceDeviceId", sourceDeviceId).gt("createdAt", now - 60 * 60 * 1000),
      )
      .take(OCR_FLAG_MAX_PER_HOUR);
    if (recent.length >= OCR_FLAG_MAX_PER_HOUR) throw new ConvexError("Too many OCR flags this hour");

    const objectKey = ocrFlagObjectKey(workspace._id, args.flagId);
    const contentType = "image/jpeg";
    await ctx.db.insert("ocrFlags", {
      flagId: args.flagId,
      workspaceId: workspace._id,
      sourceDeviceId,
      objectKey,
      contentType,
      byteCount: args.byteCount,
      status: "uploading",
      selectedRawText: args.selectedRawText,
      ...(args.selectedCleanedText ? { selectedCleanedText: args.selectedCleanedText } : {}),
      regions: args.regions,
      rawRegionTexts: args.rawRegionTexts,
      ...(args.appVersion ? { appVersion: args.appVersion } : {}),
      ...(args.appBuild ? { appBuild: args.appBuild } : {}),
      ...(args.note ? { note: args.note } : {}),
      createdAt: now,
    });
    return { objectKey, contentType };
  },
});

export const ocrFlagForDevice = internalQuery({
  args: { ...credentialArgs, flagId: v.string() },
  handler: async (ctx, args) => {
    const { sourceDeviceId } = await requireDevicePrincipal(ctx, args);
    const flag = await ctx.db
      .query("ocrFlags")
      .withIndex("by_flagId", (q) => q.eq("flagId", args.flagId))
      .unique();
    if (!flag || flag.sourceDeviceId !== sourceDeviceId) throw new ConvexError("Flag not found");
    return { objectKey: flag.objectKey, status: flag.status };
  },
});

export const markOcrFlagReady = internalMutation({
  args: { flagId: v.string() },
  handler: async (ctx, args) => {
    const flag = await ctx.db
      .query("ocrFlags")
      .withIndex("by_flagId", (q) => q.eq("flagId", args.flagId))
      .unique();
    if (!flag) throw new ConvexError("Flag not found");
    if (flag.status !== "ready") await ctx.db.patch(flag._id, { status: "ready", uploadedAt: Date.now() });
    return null;
  },
});

// Developer access: `npx convex run ocrFlags:listOcrFlags '{"limit":20}'` and
// `npx convex run ocrFlags:ocrFlagPhotoUrl '{"flagId":"..."}'` (see scripts/ocr-flags.mjs).
export const listOcrFlags = internalQuery({
  args: { limit: v.optional(v.number()), since: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    const flags = await ctx.db
      .query("ocrFlags")
      .withIndex("by_createdAt", (q) => q.gt("createdAt", args.since ?? 0))
      .order("desc")
      // Filter before take() so newer unfinished uploads don't crowd out ready flags.
      .filter((q) => q.eq(q.field("status"), "ready"))
      .take(limit);
    return flags.map(({ _id: _ignoredId, _creationTime: _ignoredCreation, workspaceId: _ignoredWorkspace, ...flag }) => flag);
  },
});

export const readyOcrFlagObjectKey = internalQuery({
  args: { flagId: v.string() },
  handler: async (ctx, args) => {
    const flag = await ctx.db
      .query("ocrFlags")
      .withIndex("by_flagId", (q) => q.eq("flagId", args.flagId))
      .unique();
    return flag?.status === "ready" ? flag.objectKey : null;
  },
});

const readyOcrFlagObjectKeyRef = makeFunctionReference<"query", { flagId: string }, string | null>(
  "ocrFlags:readyOcrFlagObjectKey",
);

export const ocrFlagPhotoUrl = internalAction({
  args: { flagId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const objectKey = await ctx.runQuery(readyOcrFlagObjectKeyRef, args);
    if (!objectKey) return null;
    return (await presignR2("GET", objectKey)).url;
  },
});
