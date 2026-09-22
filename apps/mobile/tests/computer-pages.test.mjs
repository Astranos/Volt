import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("native computer page chain preserves complete live lists and rejects obsolete requests", {
  skip: process.platform !== "darwin" && "requires the macOS Swift toolchain",
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "volt-computer-pages-"));
  const executable = join(directory, "computer-pages-fixture");
  const sources = [
    "../ios/Volt/Models/CloudComputerPageChain.swift",
    "./computer-pages-fixture.swift",
  ].map(path => fileURLToPath(new URL(path, import.meta.url)));
  try {
    execFileSync("xcrun", ["swiftc", ...sources, "-o", executable], { encoding: "utf8", stdio: "pipe" });
    assert.equal(execFileSync(executable, { encoding: "utf8" }).trim(), "computer page fixtures passed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
