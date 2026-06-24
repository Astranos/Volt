import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTimelineGroups,
  deleteTimelineEntries,
  deriveTimelineState,
  photoIdsFromBatchEntries,
  photosFromBatchEntries,
  resolvePhotoDragSelection,
  resolveTimelineMessage,
  toggleTimelinePhotoSelection,
  upsertTimelineEntry,
} from "./mobile-scanner-timeline.ts";

test("timeline selection toggles single photos and shift-selects the ordered range", () => {
  const photoOrder = ["photo-1", "photo-2", "photo-3", "photo-4"];

  const selected = toggleTimelinePhotoSelection({
    selectedPhotoIds: new Set(),
    photoOrder,
    id: "photo-2",
    anchorId: null,
  });
  assert.deepEqual([...selected], ["photo-2"]);

  const range = toggleTimelinePhotoSelection({
    selectedPhotoIds: selected,
    photoOrder,
    id: "photo-4",
    anchorId: "photo-2",
    shiftKey: true,
  });
  assert.deepEqual([...range], ["photo-2", "photo-3", "photo-4"]);

  const toggledOff = toggleTimelinePhotoSelection({
    selectedPhotoIds: range,
    photoOrder,
    id: "photo-3",
    anchorId: "photo-4",
  });
  assert.deepEqual([...toggledOff], ["photo-2", "photo-4"]);
});

test("timeline delete creates an undo snapshot and removes deleted selections", () => {
  const scan = createScan("scan-1", "2026-06-03T15:00:00.000Z");
  const photo = createPhotoResult("photo-1", "batch-1", "2026-06-03T15:01:00.000Z");
  const untouched = createPhotoResult("photo-2", "batch-1", "2026-06-03T15:02:00.000Z");

  const deleted = deleteTimelineEntries({
    results: [scan, photo, untouched],
    selectedPhotoIds: new Set(["photo-1", "photo-2"]),
    ids: ["scan-1", "photo-1"],
  });

  assert.deepEqual(deleted.deleted.map((entry) => entry.id), ["scan-1", "photo-1"]);
  assert.deepEqual(deleted.remaining.map((entry) => entry.id), ["photo-2"]);
  assert.deepEqual([...deleted.selectedPhotoIds], ["photo-2"]);
});

test("timeline groups photos by batch while keeping upload order inside a batch", () => {
  const first = createPhotoResult("photo-1", "batch-1", "2026-06-03T15:00:00.000Z");
  const second = createPhotoResult("photo-2", "batch-1", "2026-06-03T15:01:00.000Z");
  const laterScan = createScan("scan-1", "2026-06-03T15:02:00.000Z");

  const groups = buildTimelineGroups([first, second, laterScan]);

  assert.equal(groups[0].type, "scan");
  assert.equal(groups[1].type, "photo");
  assert.deepEqual(groups[1].entries.map((entry) => entry.id), ["photo-1", "photo-2"]);
});

test("timeline derives selected photo drag order from visible photo order", () => {
  const newest = createPhotoResult("photo-3", "batch-2", "2026-06-03T15:03:00.000Z");
  const middle = createPhotoResult("photo-2", "batch-1", "2026-06-03T15:02:00.000Z");
  const oldest = createPhotoResult("photo-1", "batch-1", "2026-06-03T15:01:00.000Z");

  const timeline = deriveTimelineState(
    [newest, middle, oldest],
    new Set(["photo-1", "photo-3"]),
  );
  const drag = resolvePhotoDragSelection({
    photo: timeline.photos[0],
    selectedPhotoIds: new Set(["photo-1", "photo-3"]),
    selectedPhotos: timeline.selectedPhotos,
  });

  assert.deepEqual(timeline.photoOrder, ["photo-3", "photo-2", "photo-1"]);
  assert.deepEqual(drag.sourcePhotos.map((photo) => photo.id), ["photo-3", "photo-1"]);
});

test("timeline preserves batch drag order and selected ids", () => {
  const entries = [
    createPhotoResult("photo-1", "batch-1", "2026-06-03T15:00:00.000Z"),
    createPhotoResult("photo-2", "batch-1", "2026-06-03T15:01:00.000Z"),
  ];

  assert.deepEqual(photoIdsFromBatchEntries(entries), ["photo-1", "photo-2"]);
  assert.deepEqual(photosFromBatchEntries(entries).map((photo) => photo.id), ["photo-1", "photo-2"]);
});

test("timeline resolves persisted messages and owns sidepanel fallback persistence", async () => {
  const scan = createScan("scan-1", "2026-06-03T15:00:00.000Z");
  const photo = createPhotoResult("photo-1", "batch-1", "2026-06-03T15:01:00.000Z");

  assert.equal(
    await resolveTimelineMessage(
      { action: "scannerScan", scan: scan.scan, result: scan },
      {
        saveScan: async () => null,
        savePhoto: async () => null,
      },
    ),
    scan,
  );

  const savedPhoto = await resolveTimelineMessage(
    { action: "scannerPhoto", photo: photo.photo },
    {
      saveScan: async () => null,
      savePhoto: async () => photo,
    },
  );
  assert.equal(savedPhoto, photo);

  assert.deepEqual(upsertTimelineEntry([scan], photo).map((entry) => entry.id), ["photo-1", "scan-1"]);
  assert.deepEqual(upsertTimelineEntry([scan], createScan("scan-1", "2026-06-03T15:02:00.000Z")).map((entry) => entry.id), ["scan-1"]);
});

function createScan(id, capturedAt) {
  return {
    type: "scan",
    id,
    kind: "barcode",
    value: "012345678905",
    capturedAt,
    scan: {
      id,
      kind: "barcode",
      barcode: "012345678905",
    },
  };
}

function createPhotoResult(id, photoBatchId, capturedAt) {
  return {
    type: "photo",
    id,
    photoBatchId,
    capturedAt,
    photo: {
      id,
      kind: "photo",
      photoBatchId,
      name: `${id}.jpg`,
      mimeType: "image/jpeg",
      dataUrl: `data:image/jpeg;base64,${Buffer.from(id).toString("base64")}`,
      size: 1,
      capturedAt,
    },
  };
}
