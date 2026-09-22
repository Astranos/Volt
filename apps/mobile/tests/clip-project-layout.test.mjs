import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readClipView } from "./clip-view-sources.mjs";

test("App Clip view files contain unique declarations within the source size budget", () => {
  const files = readdirSync(new URL("../ios/VoltClip/Views/", import.meta.url))
    .filter((name) => name.endsWith(".swift"));
  const declarations = new Set();
  for (const file of files) {
    const source = readClipView(file);
    assert.ok(source.split("\n").length <= 1_000, `${file} exceeds the source size budget`);
    for (const match of source.matchAll(/^(?:private )?(?:struct|class|enum) (\w+)/gm)) {
      assert.ok(!declarations.has(match[1]), `Duplicate declaration: ${match[1]}`);
      declarations.add(match[1]);
    }
  }
});

test("each App Clip view belongs to the Clip source phase exactly once", {
  skip: process.platform !== "darwin" && "requires macOS plutil for the Xcode project format",
}, () => {
  const projectPath = fileURLToPath(new URL("../ios/Volt.xcodeproj/project.pbxproj", import.meta.url));
  const project = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", projectPath], { encoding: "utf8" }));
  const objects = project.objects;
  const target = Object.values(objects).find((object) => object.isa === "PBXNativeTarget" && object.name === "VoltClip");
  assert.ok(target, "Missing VoltClip target");
  const phase = target.buildPhases.map((id) => objects[id]).find((object) => object.isa === "PBXSourcesBuildPhase");
  assert.ok(phase, "Missing Clip source build phase");
  const sourcePaths = phase.files.map((id) => objects[objects[id].fileRef].path);
  for (const file of readdirSync(new URL("../ios/VoltClip/Views/", import.meta.url)).filter((name) => name.endsWith(".swift"))) {
    assert.equal(sourcePaths.filter((path) => path === file).length, 1, `${file} needs exactly one Clip source membership`);
  }
});
