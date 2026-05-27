import { spawn } from "node:child_process";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const defaultDerivedDataPath = "/tmp/volt-debug-derived";
const defaultBundleId = "com.volt.mobile";

function parseArgs(argv = process.argv.slice(2)) {
  const normalizedArgs = argv.filter((arg) => arg !== "--");
  const options = {
    configuration: process.env.VOLT_CONFIGURATION || "Debug",
    derivedDataPath: process.env.VOLT_DERIVED_DATA_PATH || defaultDerivedDataPath,
    deviceId: process.env.VOLT_DEVICE_ID || "",
    skipBuild: false,
    skipInstall: false,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--configuration") options.configuration = normalizedArgs[++index] || "";
    else if (arg === "--device") options.deviceId = normalizedArgs[++index] || "";
    else if (arg === "--derived-data") options.derivedDataPath = normalizedArgs[++index] || "";
    else if (arg === "--release") options.configuration = "Release";
    else if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--skip-install") options.skipInstall = true;
    else if (arg === "--help") {
      console.log(`Usage: pnpm --filter @volt/mobile ios:device -- [options]

Options:
  --device DEVICE_ID        Device id from xcrun devicectl list devices
  --configuration CONFIG    Debug or Release. Default: Debug
  --release                 Alias for --configuration Release
  --derived-data PATH       Derived data path. Default: /tmp/volt-debug-derived
  --skip-build              Install and launch the existing build
  --skip-install            Launch the already-installed app
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!["Debug", "Release"].includes(options.configuration)) {
    throw new Error(`Unsupported configuration: ${options.configuration}`);
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

async function main() {
  const options = parseArgs();
  const deviceId = options.deviceId || (await resolveConnectedIphoneId());
  const appPath = path.join(
    options.derivedDataPath,
    "Build",
    "Products",
    `${options.configuration}-iphoneos`,
    "Volt.app"
  );

  console.log(`Using iPhone device: ${deviceId}`);

  if (!options.skipBuild) {
    await run("xcodebuild", [
      "-workspace",
      "apps/mobile/ios/Volt.xcworkspace",
      "-scheme",
      "Volt",
      "-configuration",
      options.configuration,
      "-destination",
      `id=${deviceId}`,
      "-derivedDataPath",
      options.derivedDataPath,
      "-allowProvisioningUpdates",
      "build",
    ]);
  }

  if (!options.skipInstall) {
    await run("xcrun", ["devicectl", "device", "install", "app", "--device", deviceId, appPath]);
  }

  await run("xcrun", [
    "devicectl",
    "device",
    "process",
    "launch",
    "--device",
    deviceId,
    "--terminate-existing",
    defaultBundleId,
  ]);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
