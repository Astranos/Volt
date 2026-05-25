import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { createRelaySession } from "../../scanner-signal/scripts/create-device-validation-session.mjs";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const appPath = "/tmp/voltclip-debug-derived/Build/Products/Debug-iphoneos/Volt Clip.app";
const defaultDerivedDataPath = "/tmp/voltclip-debug-derived";
const defaultOrigin = "https://scanner-signal.vercel.app";
const defaultMode = "ocr";
const metroPort = 8091;

function parseArgs(argv = process.argv.slice(2)) {
  const normalizedArgs = argv.filter((arg) => arg !== "--");
  const options = {
    deviceId: process.env.VOLT_DEVICE_ID || "",
    mode: process.env.VOLT_CLIP_MODE || defaultMode,
    origin: process.env.SCANNER_SIGNAL_ORIGIN || defaultOrigin,
    sessionUrl: process.env.VOLT_CLIP_URL || "",
    skipBuild: false,
    skipMetro: false,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--device") options.deviceId = normalizedArgs[++index] || "";
    else if (arg === "--mode") options.mode = normalizedArgs[++index] || "";
    else if (arg === "--origin") options.origin = normalizedArgs[++index] || "";
    else if (arg === "--url") options.sessionUrl = normalizedArgs[++index] || "";
    else if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--skip-metro") options.skipMetro = true;
    else if (arg === "--help") {
      console.log(`Usage: pnpm --filter @volt/mobile clip:device -- [options]

Options:
  --device DEVICE_ID   Device id from xcrun devicectl list devices
  --mode MODE         ocr, barcode, dictation, or photo. Default: ocr
  --url URL           Existing App Clip URL to launch instead of creating a new session
  --origin ORIGIN     Scanner signal origin. Default: https://scanner-signal.vercel.app
  --skip-build        Install and launch the existing /tmp App Clip build
  --skip-metro        Do not start Metro; useful if App Clip Metro is already running
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!["ocr", "barcode", "dictation", "photo"].includes(options.mode)) {
    throw new Error(`Unsupported App Clip mode: ${options.mode}`);
  }

  return options;
}

function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal || code}`));
    });
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnect(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Metro on port ${port}`);
}

async function resolveConnectedIphoneId() {
  const outputDir = await mkdtemp(path.join(tmpdir(), "volt-devices-"));
  const jsonPath = path.join(outputDir, "devices.json");
  try {
    await run("xcrun", ["devicectl", "list", "devices", "--json-output", jsonPath, "--quiet"], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    const payload = JSON.parse(await readFile(jsonPath, "utf8"));
    const devices = payload.result?.devices || [];
    const iphones = devices.filter((device) => {
      const properties = device.deviceProperties || {};
      const hardware = device.hardwareProperties || {};
      const connection = device.connectionProperties || {};
      return (
        hardware.platform === "iOS" &&
        properties.name?.toLowerCase().includes("iphone") &&
        connection.tunnelState === "connected"
      );
    });

    if (iphones.length === 1) return iphones[0].identifier;
    if (iphones.length > 1) {
      throw new Error(
        `Multiple connected iPhones found. Set VOLT_DEVICE_ID or pass --device. Found: ${iphones
          .map((device) => `${device.deviceProperties?.name || "iPhone"} (${device.identifier})`)
          .join(", ")}`
      );
    }
    throw new Error("No connected iPhone found. Plug in the phone, unlock it, then rerun.");
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
}

function startMetroIfNeeded({ skipMetro }) {
  if (skipMetro) return null;

  const child = spawn("pnpm", ["--filter", "@volt/mobile", "dev:clip"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGINT" && signal !== "SIGTERM") {
      console.error(`App Clip Metro exited with ${signal || code}`);
      process.exitCode = code || 1;
    }
  });

  return child;
}

async function main() {
  const options = parseArgs();
  const deviceId = options.deviceId || (await resolveConnectedIphoneId());

  console.log(`Using iPhone device: ${deviceId}`);

  let metro = null;
  const metroAlreadyRunning = await canConnect(metroPort);
  if (metroAlreadyRunning) {
    console.log(`Reusing existing App Clip Metro on port ${metroPort}.`);
  } else {
    metro = startMetroIfNeeded(options);
    if (!metro) {
      console.log(`Skipping Metro startup; expecting App Clip Metro on port ${metroPort}.`);
    } else {
      await waitForPort(metroPort);
      console.log(`App Clip Metro is listening on port ${metroPort}.`);
    }
  }

  if (!options.skipBuild) {
    await run("xcodebuild", [
      "-workspace",
      "apps/mobile/ios/Volt.xcworkspace",
      "-scheme",
      "VoltClip",
      "-configuration",
      "Debug",
      "-destination",
      `id=${deviceId}`,
      "-derivedDataPath",
      defaultDerivedDataPath,
      "build",
    ]);
  }

  await run("xcrun", ["devicectl", "device", "install", "app", "--device", deviceId, appPath]);

  const sessionUrl =
    options.sessionUrl ||
    (await createRelaySession({
      mode: options.mode,
      origin: options.origin,
    })).url;

  console.log(`Launching App Clip: ${sessionUrl}`);
  await run("xcrun", [
    "devicectl",
    "device",
    "process",
    "launch",
    "--device",
    deviceId,
    "--terminate-existing",
    "--payload-url",
    sessionUrl,
    "com.volt.mobile.Clip",
  ]);

  if (metro && !metro.killed) {
    console.log("\nApp Clip launched. Metro is still running; press Ctrl-C to stop it.");
    await new Promise((resolve) => {
      process.once("SIGINT", () => {
        metro.kill("SIGINT");
        resolve();
      });
      metro.once("exit", resolve);
    });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
