// Stable Convex API. Domain modules export plain handlers, never registered functions.
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import * as identity from "./cloudWorkspace/identity";
import * as devices from "./cloudWorkspace/devices";
import * as dictation from "./cloudWorkspace/dictation";
import * as batches from "./cloudWorkspace/batches";
import * as photos from "./cloudWorkspace/photos";
import * as deliveries from "./cloudWorkspace/deliveries";

export { ENROLLMENT_TTL_MS } from "./cloudWorkspace/identity";
export { APP_CLIP_GRANT_TTL_MS } from "./cloudWorkspace/identity";
export const ensureWorkspace = mutation({
  args: identity.ensureWorkspaceArgs,
  handler: identity.ensureWorkspaceHandler,
});

export const createGuestGrant = internalMutation({
  args: identity.createGuestGrantArgs,
  handler: identity.createGuestGrantHandler,
});

export const createAppClipWorkspaceGrantForHttp = internalMutation({
  args: identity.createAppClipWorkspaceGrantForHttpArgs,
  returns: identity.createAppClipWorkspaceGrantForHttpReturns,
  handler: identity.createAppClipWorkspaceGrantForHttpHandler,
});

export const createEnrollment = mutation({
  args: devices.createEnrollmentArgs,
  handler: devices.createEnrollmentHandler,
});

export const exchangeEnrollment = mutation({
  args: devices.exchangeEnrollmentArgs,
  handler: devices.exchangeEnrollmentHandler,
});

export const bootstrapMobileDevice = mutation({
  args: devices.bootstrapMobileDeviceArgs,
  handler: devices.bootstrapMobileDeviceHandler,
});

export const registerComputer = mutation({
  args: devices.registerComputerArgs,
  handler: devices.registerComputerHandler,
});

export const revokeDevice = mutation({
  args: devices.revokeDeviceArgs,
  handler: devices.revokeDeviceHandler,
});

export const updatePresence = mutation({
  args: devices.updatePresenceArgs,
  handler: devices.updatePresenceHandler,
});

export const sweepExpiredPresence = internalMutation({
  args: devices.sweepExpiredPresenceArgs,
  handler: devices.sweepExpiredPresenceHandler,
});

export const listComputersForDevice = query({
  args: devices.listComputersForDeviceArgs,
  handler: devices.listComputersForDeviceHandler,
});

export const listComputersForGuest = query({
  args: devices.listComputersForGuestArgs,
  handler: devices.listComputersForGuestHandler,
});

export const setCursorTarget = mutation({
  args: devices.setCursorTargetArgs,
  handler: devices.setCursorTargetHandler,
});

export const listComputers = query({
  args: devices.listComputersArgs,
  handler: devices.listComputersHandler,
});

export { DICTATION_DRAFT_TTL_MS } from "./cloudWorkspace/dictation";
export const updateDictationDraft = mutation({
  args: dictation.updateDictationDraftArgs,
  returns: dictation.updateDictationDraftReturns,
  handler: dictation.updateDictationDraftHandler,
});

export const clearDictationDraft = mutation({
  args: dictation.clearDictationDraftArgs,
  returns: dictation.clearDictationDraftReturns,
  handler: dictation.clearDictationDraftHandler,
});

export const liveDictationDraftsForComputer = query({
  args: dictation.liveDictationDraftsForComputerArgs,
  returns: dictation.liveDictationDraftsForComputerReturns,
  handler: dictation.liveDictationDraftsForComputerHandler,
});

export const putBatch = mutation({
  args: batches.putBatchArgs,
  handler: batches.putBatchHandler,
});

export const putGuestBatch = mutation({
  args: batches.putGuestBatchArgs,
  handler: batches.putGuestBatchHandler,
});

export const markBatchReady = internalMutation({
  args: batches.markBatchReadyArgs,
  handler: batches.markBatchReadyHandler,
});

export const markGuestBatchReady = internalMutation({
  args: batches.markGuestBatchReadyArgs,
  handler: batches.markGuestBatchReadyHandler,
});

export const listBatches = query({
  args: batches.listBatchesArgs,
  handler: batches.listBatchesHandler,
});

export const listBatchResults = query({
  args: batches.listBatchResultsArgs,
  handler: batches.listBatchResultsHandler,
});

export const deleteWorkspaceResults = mutation({
  args: batches.deleteWorkspaceResultsArgs,
  handler: batches.deleteWorkspaceResultsHandler,
});

export const restoreWorkspaceResults = mutation({
  args: batches.restoreWorkspaceResultsArgs,
  handler: batches.restoreWorkspaceResultsHandler,
});

export const workspaceSnapshot = query({
  args: batches.workspaceSnapshotArgs,
  handler: batches.workspaceSnapshotHandler,
});

export { PRESIGN_TTL_SECONDS } from "./cloudWorkspace/photos";
export const photoManifestForFinalize = internalQuery({
  args: photos.photoManifestForFinalizeArgs,
  handler: photos.photoManifestForFinalizeHandler,
});

export const guestPhotoManifestForFinalize = internalQuery({
  args: photos.guestPhotoManifestForFinalizeArgs,
  handler: photos.guestPhotoManifestForFinalizeHandler,
});

export const finalizeBatchUploads = action({
  args: photos.finalizeBatchUploadsArgs,
  handler: photos.finalizeBatchUploadsHandler,
});

export const finalizeGuestBatchUploads = action({
  args: photos.finalizeGuestBatchUploadsArgs,
  handler: photos.finalizeGuestBatchUploadsHandler,
});

export const authorizePhotoAccess = internalQuery({
  args: photos.authorizePhotoAccessArgs,
  handler: photos.authorizePhotoAccessHandler,
});

export const createPhotoUploadUrl = action({
  args: photos.createPhotoUploadUrlArgs,
  handler: photos.createPhotoUploadUrlHandler,
});

export const createGuestPhotoUploadUrl = action({
  args: photos.createGuestPhotoUploadUrlArgs,
  handler: photos.createGuestPhotoUploadUrlHandler,
});

export const createPhotoDownloadUrl = action({
  args: photos.createPhotoDownloadUrlArgs,
  handler: photos.createPhotoDownloadUrlHandler,
});

export { presignR2 } from "./cloudWorkspace/photos";
export { CURSOR_DELIVERY_TTL_MS } from "./cloudWorkspace/deliveries";
export const sweepExpiredCursorDeliveries = internalMutation({
  args: deliveries.sweepExpiredCursorDeliveriesArgs,
  handler: deliveries.sweepExpiredCursorDeliveriesHandler,
});

export const queueDelivery = mutation({
  args: deliveries.queueDeliveryArgs,
  handler: deliveries.queueDeliveryHandler,
});

export const acknowledgeDelivery = mutation({
  args: deliveries.acknowledgeDeliveryArgs,
  handler: deliveries.acknowledgeDeliveryHandler,
});

export const acknowledgeDeliveryAsComputer = mutation({
  args: deliveries.acknowledgeDeliveryAsComputerArgs,
  handler: deliveries.acknowledgeDeliveryAsComputerHandler,
});

export const queueCursorDelivery = mutation({
  args: deliveries.queueCursorDeliveryArgs,
  handler: deliveries.queueCursorDeliveryHandler,
});

export const queueGuestCursorDelivery = mutation({
  args: deliveries.queueGuestCursorDeliveryArgs,
  handler: deliveries.queueGuestCursorDeliveryHandler,
});

export const pendingCursorDeliveries = query({
  args: deliveries.pendingCursorDeliveriesArgs,
  handler: deliveries.pendingCursorDeliveriesHandler,
});

export const acknowledgeCursorDelivery = mutation({
  args: deliveries.acknowledgeCursorDeliveryArgs,
  handler: deliveries.acknowledgeCursorDeliveryHandler,
});

export const cursorDeliveryStatus = query({
  args: deliveries.cursorDeliveryStatusArgs,
  handler: deliveries.cursorDeliveryStatusHandler,
});
