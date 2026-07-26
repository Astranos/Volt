import assert from "node:assert/strict";
import test from "node:test";

import {
  createCloudLiveDictationController,
  normalizeLiveDictationDrafts,
} from "./cloud-live-dictation-controller.ts";

test("normalizes live drafts newest first", () => {
  assert.deepEqual(normalizeLiveDictationDrafts([
    { draftId: "older", text: "one", updatedAt: 1 },
    { draftId: "newer", text: "two", updatedAt: 2 },
    { draftId: "invalid", text: 3, updatedAt: 3 },
  ]), [
    { draftId: "newer", text: "two", updatedAt: 2 },
    { draftId: "older", text: "one", updatedAt: 1 },
  ]);
});

test("streams the latest draft into the tracked cursor as replaceable dictation", async () => {
  const insertions = [];
  const controller = createCloudLiveDictationController({
    insertScannerText: async (...args) => {
      insertions.push(args);
      return true;
    },
    log: () => {},
  });

  await controller.handleDrafts([{ draftId: "draft-1", text: "hello", updatedAt: 1 }]);
  await controller.handleDrafts([{ draftId: "draft-1", text: "hello world", updatedAt: 2 }]);

  assert.deepEqual(insertions, [
    ["hello", {
      dictationPhase: "partial",
      dictationSessionId: "draft-1",
      format: "dictation",
      kind: "text",
    }],
    ["hello world", {
      dictationPhase: "partial",
      dictationSessionId: "draft-1",
      format: "dictation",
      kind: "text",
    }],
  ]);
});

test("ignores stale updates and drafts already finalized by cursor delivery", async () => {
  const insertions = [];
  const controller = createCloudLiveDictationController({
    insertScannerText: async (...args) => {
      insertions.push(args);
      return true;
    },
    log: () => {},
  });

  await controller.handleDrafts([{ draftId: "draft-1", text: "hello", updatedAt: 2 }]);
  await controller.handleDrafts([{ draftId: "draft-1", text: "stale", updatedAt: 1 }]);
  controller.finalizeDraft("draft-1");
  await controller.handleDrafts([{ draftId: "draft-1", text: "late", updatedAt: 3 }]);

  assert.equal(insertions.length, 1);
});

test("removes provisional text when dictation moves to another computer", async () => {
  const insertions = [];
  const controller = createCloudLiveDictationController({
    insertScannerText: async (...args) => {
      insertions.push(args);
      return true;
    },
    log: () => {},
  });

  await controller.handleDrafts([{ draftId: "draft-1", text: "hello", updatedAt: 1 }]);
  await controller.handleDrafts([]);

  assert.deepEqual(insertions[1], ["", {
    dictationPhase: "cancel",
    dictationSessionId: "draft-1",
    format: "dictation",
    kind: "text",
  }]);
});
