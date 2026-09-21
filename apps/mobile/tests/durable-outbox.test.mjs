import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("durable outbox restores photos, isolates owners, and retries interrupted delivery", {
  skip: process.platform !== "darwin" && "requires the macOS Swift toolchain",
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "volt-outbox-test-"));
  const executable = join(directory, "outbox-fixture");
  const sources = [
    "../ios/Volt/Models/ScanResult.swift",
    "../ios/Volt/Models/CloudCaptureRecord.swift",
    "../ios/Volt/Services/DurableCaptureOutbox.swift",
    "./durable-outbox-fixture.swift",
  ].map((path) => fileURLToPath(new URL(path, import.meta.url)));

  try {
    // Compile complete production declarations, without persistence mocks.
    execFileSync("xcrun", ["swiftc", ...sources, "-o", executable], {
      encoding: "utf8",
      stdio: "pipe",
    });
    const output = execFileSync(executable, [join(directory, "records")], { encoding: "utf8" });
    assert.equal(output.trim(), "durable outbox fixtures passed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
