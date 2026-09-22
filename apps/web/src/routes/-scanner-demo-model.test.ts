import { expect, test } from "vitest";
import { bytesFromBase64, normalizeJoinAttempt, normalizeSessionDescription, normalizedSessionLabel } from "./-scanner-demo-model";

test("normalizes both signaling answer formats", () => {
  const answer = { type: "answer", sdp: "v=0" };
  expect(normalizeJoinAttempt({ joinAttemptId: "new", id: "old", answer: JSON.stringify(answer) })).toEqual({ id: "new", answer, hasAnswer: true });
  expect(normalizeJoinAttempt({ id: "old", answer })).toEqual({ id: "old", answer, hasAnswer: true });
  expect(normalizeJoinAttempt({ id: "pending", hasAnswer: false })).toEqual({ id: "pending", answer: null, hasAnswer: false });
});

test("rejects unusable signaling values", () => {
  for (const input of [null, {}, { id: "" }, { id: 42 }]) expect(normalizeJoinAttempt(input)).toBeNull();
  for (const input of ["not json", { type: "unknown", sdp: "v=0" }, { type: "answer", sdp: 42 }]) expect(normalizeSessionDescription(input)).toBeNull();
});

test("normalizes session labels and decodes binary photo payloads", () => {
  expect(normalizedSessionLabel("  Browser   session  ")).toBe("Browser session");
  expect(normalizedSessionLabel(" \n ")).toBe("Browser session");
  expect([...bytesFromBase64("AAH/")]).toEqual([0, 1, 255]);
});
