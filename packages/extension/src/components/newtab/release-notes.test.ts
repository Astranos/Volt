import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { RELEASE_NOTES_VERSION, RELEASE_SETTINGS_LINKS, notesForVersion } from "./release-notes";

const packagePath = fileURLToPath(new URL("../../../package.json", import.meta.url));
const extensionPackage = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string };

describe("new-tab release notes", () => {
  test("are updated whenever the extension version changes", () => {
    expect(RELEASE_NOTES_VERSION).toBe(extensionPackage.version);
    expect(notesForVersion(extensionPackage.version)).toHaveLength(4);
  });

  test("link to existing settings sections", () => {
    const files = ["ShopifyAuditSettings.tsx", "SelectionActionsSettings.tsx", "FeatureTogglesSettings.tsx"];
    const settings = files.map((file) => readFileSync(fileURLToPath(new URL(`../settings/${file}`, import.meta.url)), "utf8")).join("\n");
    for (const link of RELEASE_SETTINGS_LINKS) expect(settings).toContain(`id="${link.hash}"`);
  });
});
