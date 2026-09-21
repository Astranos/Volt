import { describe, expect, test } from "vitest";
import * as workspace from "./cloudWorkspace";
import * as batches from "./cloudWorkspace/batches";
import * as deliveries from "./cloudWorkspace/deliveries";
import * as devices from "./cloudWorkspace/devices";
import * as dictation from "./cloudWorkspace/dictation";
import * as identity from "./cloudWorkspace/identity";
import * as photos from "./cloudWorkspace/photos";
import http from "./http";

function registrationKind(value: unknown): string | null {
  if (typeof value !== "function") return null;
  const internal = "isInternal" in value && value.isInternal === true;
  if ("isMutation" in value && value.isMutation === true) return internal ? "internalMutation" : "mutation";
  if ("isQuery" in value && value.isQuery === true) return internal ? "internalQuery" : "query";
  if ("isAction" in value && value.isAction === true) return internal ? "internalAction" : "action";
  return null;
}

function registrations(module: Record<string, unknown>): string[] {
  return Object.entries(module).flatMap(([name, value]) => {
    const kind = registrationKind(value);
    return kind ? [name + ":" + kind] : [];
  }).sort();
}

describe("backend compatibility contracts", () => {
  test("preserves workspace endpoint names and visibility", () => {
    expect(registrations(workspace)).toEqual([
      "acknowledgeCursorDelivery:mutation",
      "acknowledgeDelivery:mutation",
      "acknowledgeDeliveryAsComputer:mutation",
      "authorizePhotoAccess:internalQuery",
      "bootstrapMobileDevice:mutation",
      "clearDictationDraft:mutation",
      "createAppClipWorkspaceGrantForHttp:internalMutation",
      "createEnrollment:mutation",
      "createGuestGrant:internalMutation",
      "createGuestPhotoUploadUrl:action",
      "createPhotoDownloadUrl:action",
      "createPhotoUploadUrl:action",
      "cursorDeliveryStatus:query",
      "deleteWorkspaceResults:mutation",
      "ensureWorkspace:mutation",
      "exchangeEnrollment:mutation",
      "finalizeBatchUploads:action",
      "finalizeGuestBatchUploads:action",
      "guestPhotoManifestForFinalize:internalQuery",
      "listBatchResults:query",
      "listBatches:query",
      "listComputers:query",
      "listComputersForDevice:query",
      "listComputersForGuest:query",
      "liveDictationDraftsForComputer:query",
      "markBatchReady:internalMutation",
      "markGuestBatchReady:internalMutation",
      "pendingCursorDeliveries:query",
      "photoManifestForFinalize:internalQuery",
      "putBatch:mutation",
      "putGuestBatch:mutation",
      "queueCursorDelivery:mutation",
      "queueDelivery:mutation",
      "queueGuestCursorDelivery:mutation",
      "registerComputer:mutation",
      "restoreWorkspaceResults:mutation",
      "revokeDevice:mutation",
      "setCursorTarget:mutation",
      "sweepExpiredCursorDeliveries:internalMutation",
      "sweepExpiredPresence:internalMutation",
      "updateDictationDraft:mutation",
      "updatePresence:mutation",
      "workspaceSnapshot:query"
]);
  });

  test("domain helper exports cannot become extra Convex endpoints", () => {
    const modules = { batches, deliveries, devices, dictation, identity, photos };
    for (const [path, module] of Object.entries(modules)) {
      expect(registrations(module), path).toEqual([]);
    }
  });

  test("preserves every HTTP method and exact or prefix route", () => {
    const routes = http.getRoutes().map(([path, method]) => method + " " + path).sort();
    expect(routes).toEqual([
      "GET /api/access/status",
      "GET /api/signal",
      "GET /api/signal/*",
      "GET /api/workspace/snapshot",
      "GET /v1/products",
      "GET /v1/products/*",
      "OPTIONS /api/access/anonymous",
      "OPTIONS /api/access/session/disconnect",
      "OPTIONS /api/access/session/end",
      "OPTIONS /api/access/status",
      "OPTIONS /api/app-clip/batches/finalize",
      "OPTIONS /api/app-clip/computers/list",
      "OPTIONS /api/app-clip/deliveries/queue",
      "OPTIONS /api/app-clip/grants/create",
      "OPTIONS /api/app-clip/outbox/sync",
      "OPTIONS /api/app-clip/photos/upload-url",
      "OPTIONS /api/mobile/ai/analyze",
      "OPTIONS /api/mobile/batches/finalize",
      "OPTIONS /api/mobile/computers/list",
      "OPTIONS /api/mobile/cursor-target",
      "OPTIONS /api/mobile/deliveries/queue",
      "OPTIONS /api/mobile/deliveries/status",
      "OPTIONS /api/mobile/devices/bootstrap",
      "OPTIONS /api/mobile/enrollment/exchange",
      "OPTIONS /api/mobile/outbox/sync",
      "OPTIONS /api/mobile/photos/upload-url",
      "OPTIONS /api/signal",
      "OPTIONS /api/signal/*",
      "OPTIONS /api/storekit/notifications",
      "OPTIONS /api/storekit/transactions",
      "OPTIONS /api/workspace/computers/register",
      "OPTIONS /api/workspace/deliveries/ack",
      "OPTIONS /api/workspace/enrollment",
      "OPTIONS /api/workspace/photos/download-url",
      "OPTIONS /api/workspace/results/delete",
      "OPTIONS /api/workspace/results/restore",
      "OPTIONS /api/workspace/snapshot",
      "OPTIONS /v1/products",
      "OPTIONS /v1/products/*",
      "POST /api/access/anonymous",
      "POST /api/access/session/disconnect",
      "POST /api/access/session/end",
      "POST /api/app-clip/batches/finalize",
      "POST /api/app-clip/computers/list",
      "POST /api/app-clip/deliveries/queue",
      "POST /api/app-clip/grants/create",
      "POST /api/app-clip/outbox/sync",
      "POST /api/app-clip/photos/upload-url",
      "POST /api/mobile/ai/analyze",
      "POST /api/mobile/batches/finalize",
      "POST /api/mobile/computers/list",
      "POST /api/mobile/cursor-target",
      "POST /api/mobile/deliveries/queue",
      "POST /api/mobile/deliveries/status",
      "POST /api/mobile/devices/bootstrap",
      "POST /api/mobile/enrollment/exchange",
      "POST /api/mobile/outbox/sync",
      "POST /api/mobile/photos/upload-url",
      "POST /api/signal",
      "POST /api/signal/*",
      "POST /api/storekit/notifications",
      "POST /api/storekit/transactions",
      "POST /api/workspace/computers/register",
      "POST /api/workspace/deliveries/ack",
      "POST /api/workspace/enrollment",
      "POST /api/workspace/photos/download-url",
      "POST /api/workspace/results/delete",
      "POST /api/workspace/results/restore"
]);
  });
});
