import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction } from "../_generated/server";
import { presignR2 } from "../cloudWorkspace/photos";
import { ocrFlagInputFrom, type OcrFlagRegion } from "../ocrFlags";
import { signalBodyFromRequest, stringFrom } from "../scannerSignal/httpAdapter";
import { emptyResponse, jsonResponse } from "./shared";

type DeviceCredential = { deviceId: string; deviceSecret: string };

const createOcrFlagRecord = makeFunctionReference<
  "mutation",
  DeviceCredential & {
    flagId: string;
    byteCount: number;
    selectedRawText: string;
    selectedCleanedText?: string;
    regions: OcrFlagRegion[];
    rawRegionTexts: string[];
    appVersion?: string;
    appBuild?: string;
    note?: string;
  },
  { objectKey: string; contentType: string }
>("ocrFlags:createOcrFlagRecord");

const ocrFlagForDevice = makeFunctionReference<
  "query",
  DeviceCredential & { flagId: string },
  { objectKey: string; status: "uploading" | "ready" }
>("ocrFlags:ocrFlagForDevice");

const markOcrFlagReady = makeFunctionReference<"mutation", { flagId: string }, null>("ocrFlags:markOcrFlagReady");

function credentialFrom(body: Record<string, unknown>): DeviceCredential | null {
  const deviceId = stringFrom(body.deviceId, 120);
  const deviceSecret = stringFrom(body.deviceSecret, 240);
  return deviceId && deviceSecret ? { deviceId, deviceSecret } : null;
}

function errorResponse(error: unknown) {
  const message = error instanceof ConvexError ? String(error.data) : "";
  if (message.includes("device credential")) return jsonResponse({ error: "Device credential rejected" }, 401);
  if (message.includes("Too many")) return jsonResponse({ error: message }, 429);
  if (message.includes("not found") || message.includes("another device")) return jsonResponse({ error: message }, 404);
  if (message.includes("not configured")) return jsonResponse({ error: "Photo storage is unavailable" }, 503);
  console.error("OCR flag request failed", error);
  return jsonResponse({ error: "OCR flag failed" }, 500);
}

/** POST /api/mobile/ocr-flags — records the recognizer output and returns a presigned R2 PUT for the photo. */
export const mobileOcrFlagCreateHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const credential = credentialFrom(body);
  const input = ocrFlagInputFrom(body);
  if (!credential || !input) return jsonResponse({ error: "Invalid OCR flag" }, 400);
  try {
    const record = await ctx.runMutation(createOcrFlagRecord, { ...credential, ...input });
    const upload = await presignR2("PUT", record.objectKey, record.contentType);
    return jsonResponse({ flagId: input.flagId, upload: { url: upload.url, headers: upload.headers } });
  } catch (error) {
    return errorResponse(error);
  }
});

/** POST /api/mobile/ocr-flags/finalize — confirms the photo reached R2 before the flag is listed. */
export const mobileOcrFlagFinalizeHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const credential = credentialFrom(body);
  const flagId = stringFrom(body.flagId, 64)?.toLowerCase();
  if (!credential || !flagId) return jsonResponse({ error: "Invalid OCR flag" }, 400);
  try {
    const flag = await ctx.runQuery(ocrFlagForDevice, { ...credential, flagId });
    if (flag.status !== "ready") {
      const head = await presignR2("HEAD", flag.objectKey);
      const response = await fetch(head.url, { method: "HEAD" });
      if (!response.ok) return jsonResponse({ error: "Photo has not been uploaded" }, 409);
      await ctx.runMutation(markOcrFlagReady, { flagId });
    }
    return jsonResponse({ flagId, status: "ready" });
  } catch (error) {
    return errorResponse(error);
  }
});
