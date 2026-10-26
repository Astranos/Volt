import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { RELEASE_NOTES, RELEASE_NOTES_ID, RELEASE_NOTES_VERSION, RELEASE_SETTINGS_LINKS, releaseNotesId, shouldAnnounceRelease } from "./release-notes";

const packagePath = fileURLToPath(new URL("../../../package.json", import.meta.url));
const extensionPackage = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string };

describe("new-tab release notes", () => {
  test("the unread ID changes when a description changes", () => {
    const edited = RELEASE_NOTES.map((note, index) => index === 0 ? { ...note, description: `${note.description} Updated.` } : note);
    expect(releaseNotesId(RELEASE_NOTES)).toBe(RELEASE_NOTES_ID);
    expect(releaseNotesId(edited)).not.toBe(RELEASE_NOTES_ID);
    expect(releaseNotesId(RELEASE_NOTES.map((note) => ({ ...note })))).toBe(RELEASE_NOTES_ID);
  });

  test("announce a release no newer than the package version", () => {
    const [notes, pkg] = [RELEASE_NOTES_VERSION, extensionPackage.version].map((v) => v.split(".").map(Number));
    expect(notes[0] * 1e10 + notes[1] * 1e5 + notes[2]).toBeLessThanOrEqual(pkg[0] * 1e10 + pkg[1] * 1e5 + pkg[2]);
  });

  test("open once per announced release, and stay quiet for bug-fix updates", () => {
    expect(shouldAnnounceRelease(undefined)).toBe(true);
    expect(shouldAnnounceRelease("1.0.60")).toBe(true);
    expect(shouldAnnounceRelease(RELEASE_NOTES_VERSION)).toBe(false);
    // Users who already dismissed a later (bug-fix) version aren't shown it again.
    expect(shouldAnnounceRelease("1.0.73")).toBe(false);
    expect(shouldAnnounceRelease("1.0.100")).toBe(false);
  });

  test("link to existing settings sections", () => {
    const files = ["ShopifyAuditSettings.tsx", "SelectionActionsSettings.tsx", "FeatureTogglesSettings.tsx"];
    const settings = files.map((file) => readFileSync(fileURLToPath(new URL(`../settings/${file}`, import.meta.url)), "utf8")).join("\n");
    for (const link of RELEASE_SETTINGS_LINKS) expect(settings).toContain(`id="${link.hash}"`);
  });
});
