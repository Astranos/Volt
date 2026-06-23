#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const args = new Set(forwardedArgs);
const getArg = (name, fallback) => {
  const prefix = `${name}=`;
  const value = forwardedArgs.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
};

const configuration = args.has("--release") ? "Release" : "Debug";
const workspace = "ios/Volt.xcworkspace";
const target = args.has("--appclip")
  ? {
      scheme: "VoltClip",
      bundleId: "com.volt.mobile.Clip",
      productName: "VoltClip",
      derivedDataDirectory: "build-appclip",
    }
  : {
      scheme: "Volt",
      bundleId: "com.volt.mobile",
      productName: "Volt",
      derivedDataDirectory: "build",
    };
const derivedData = path.resolve("ios", target.derivedDataDirectory);
const mode = args.has("--device") ? "device" : "simulator";
const destinationName = getArg("--name", mode === "device" ? undefined : "iPhone 17 Pro Max");
const destinationId = getArg("--id", undefined);

function run(command, commandArgs, options = {}) {
  console.log(`$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function output(command, commandArgs) {
  return execFileSync(command, commandArgs, { encoding: "utf8" }).trim();
}

function simulatorId() {
  if (destinationId) return destinationId;
  const devices = JSON.parse(output("xcrun", ["simctl", "list", "devices", "available", "--json"]));
  for (const runtime of Object.values(devices.devices)) {
    const match = runtime.find((device) => device.name === destinationName);
    if (match) return match.udid;
  }
  throw new Error(`No available simulator named "${destinationName}". Pass --name="..." or --id=...`);
}

function physicalDeviceId() {
  if (destinationId) return destinationId;
  const destinations = output("xcodebuild", [
    "-workspace", workspace,
    "-scheme", target.scheme,
    "-showdestinations",
  ]);
  const lines = destinations
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.includes("platform:iOS,"));

  for (const line of lines) {
    if (line.includes("dvtdevice-DVTiPhonePlaceholder")) continue;
    if (destinationName && !line.includes(`name:${destinationName}`)) continue;
    const idMatch = line.match(/\bid:([^,}]+)/);
    if (idMatch) return idMatch[1].trim();
  }

  const nameHint = destinationName ? ` named "${destinationName}"` : "";
  throw new Error(`No connected iOS device${nameHint}. Pass --id=... or connect and unlock the device.`);
}

function bootSimulator(udid) {
  spawnSync("xcrun", ["simctl", "boot", udid], { stdio: "ignore" });
  run("xcrun", ["simctl", "bootstatus", udid, "-b"]);
}

function build(destination) {
  const commandArgs = [
    "-workspace", workspace,
    "-scheme", target.scheme,
    "-configuration", configuration,
    "-derivedDataPath", derivedData,
    "-destination", destination,
  ];
  if (mode === "device") commandArgs.push("-allowProvisioningUpdates");
  run("xcodebuild", [...commandArgs, "build"]);
}

if (mode === "simulator") {
  const udid = simulatorId();
  bootSimulator(udid);
  build(`platform=iOS Simulator,id=${udid}`);
  const appPath = path.join(derivedData, "Build/Products", `${configuration}-iphonesimulator`, `${target.productName}.app`);
  if (!existsSync(appPath)) throw new Error(`Built app not found at ${appPath}`);
  run("xcrun", ["simctl", "install", udid, appPath]);
  run("xcrun", ["simctl", "launch", udid, target.bundleId]);
  process.exit(0);
}

const deviceId = physicalDeviceId();
build(`platform=iOS,id=${deviceId}`);
const appPath = path.join(derivedData, "Build/Products", `${configuration}-iphoneos`, `${target.productName}.app`);
if (!existsSync(appPath)) throw new Error(`Built app not found at ${appPath}`);

run("xcrun", ["devicectl", "device", "install", "app", "--device", deviceId, appPath]);
run("xcrun", ["devicectl", "device", "process", "launch", "--device", deviceId, target.bundleId]);
