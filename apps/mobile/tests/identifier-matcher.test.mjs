import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("Swift identifier matcher handles real OCR ambiguity fixtures", {
  skip: process.platform === "darwin"
    ? false
    : "requires macOS xcrun and the Apple Vision/CoreGraphics frameworks",
}, () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "volt-identifier-matcher-"));
  const executable = join(temporaryDirectory, "identifier-matcher-fixture");
  const productionSource = fileURLToPath(
    new URL("../ios/Volt/Models/ScannerRecognitionModels.swift", import.meta.url)
  );
  const fixtureSource = fileURLToPath(new URL("./identifier-matcher-fixture.swift", import.meta.url));

  try {
    execFileSync("xcrun", ["swiftc", productionSource, fixtureSource, "-o", executable], {
      encoding: "utf8",
      stdio: "pipe",
    });
    const output = execFileSync(executable, { encoding: "utf8" });
    assert.equal(output.trim(), "identifier matcher fixtures passed");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
