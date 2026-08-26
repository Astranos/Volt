#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME_WEB_STORE_SCOPE =
  "https://www.googleapis.com/auth/chromewebstore";
const API_ORIGIN = "https://chromewebstore.googleapis.com";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(packageRoot, "package.json");

export function parseChromeVersion(value) {
  if (!/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(value)) {
    throw new Error(`Invalid Chrome extension version: ${value}`);
  }

  const parts = value.split(".").map(Number);
  if (parts.every((part) => part === 0) || parts.some((part) => part > 65_535)) {
    throw new Error(`Invalid Chrome extension version: ${value}`);
  }

  return [...parts, ...Array(4 - parts.length).fill(0)];
}

export function compareChromeVersions(left, right) {
  const leftParts = parseChromeVersion(left);
  const rightParts = parseChromeVersion(right);

  for (let index = 0; index < 4; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }

  return 0;
}

export function nextPatchVersion(versions) {
  if (versions.length === 0) {
    throw new Error("At least one version is required");
  }

  const highest = versions.reduce((current, candidate) =>
    compareChromeVersions(candidate, current) > 0 ? candidate : current,
  );
  const [major, minor, patch] = parseChromeVersion(highest);

  if (patch < 65_535) return `${major}.${minor}.${patch + 1}`;
  if (minor < 65_535) return `${major}.${minor + 1}.0`;
  if (major < 65_535) return `${major + 1}.0.0`;

  throw new Error("Chrome extension version space is exhausted");
}

export function nextReleaseVersion(sourceVersion, versionsInStore) {
  parseChromeVersion(sourceVersion);
  if (versionsInStore.length === 0) return sourceVersion;

  const nextStoreVersion = nextPatchVersion(versionsInStore);
  return compareChromeVersions(sourceVersion, nextStoreVersion) >= 0
    ? sourceVersion
    : nextStoreVersion;
}

export function storeVersions(status) {
  const revisions = [
    status.publishedItemRevisionStatus,
    status.submittedItemRevisionStatus,
  ];

  return revisions.flatMap(
    (revision) =>
      revision?.distributionChannels
        ?.map((channel) => channel.crxVersion)
        .filter((version) => typeof version === "string") ?? [],
  );
}

export function chromeExtensionIdFromPublicKey(publicKey) {
  const normalized = publicKey.replace(/\s/g, "");
  const decoded = Buffer.from(normalized, "base64");
  if (!normalized || decoded.length === 0) {
    throw new Error("WXT_EXTENSION_PUBLIC_KEY must be a base64-encoded public key");
  }

  return [...createHash("sha256").update(decoded).digest().subarray(0, 16)]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => String.fromCharCode("a".charCodeAt(0) + nibble))
    .join("");
}

export function validateProductionBuildEnv(env) {
  const clerkPublishableKey = env.WXT_CLERK_PUBLISHABLE_KEY?.trim();
  if (!clerkPublishableKey?.startsWith("pk_live_")) {
    throw new Error(
      "WXT_CLERK_PUBLISHABLE_KEY must be a Clerk production publishable key",
    );
  }

  const extensionPublicKey = env.WXT_EXTENSION_PUBLIC_KEY?.trim();
  if (!extensionPublicKey) {
    throw new Error("Missing WXT_EXTENSION_PUBLIC_KEY");
  }

  const extensionId = chromeExtensionIdFromPublicKey(extensionPublicKey);
  const expectedExtensionId = env.CWS_EXTENSION_ID?.trim();
  if (expectedExtensionId && extensionId !== expectedExtensionId) {
    throw new Error(
      `WXT_EXTENSION_PUBLIC_KEY resolves to ${extensionId}, expected ${expectedExtensionId}`,
    );
  }

  return { clerkPublishableKey, extensionId, extensionPublicKey };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Copy .env.cws.example to .env.cws.`);
  return value;
}

function accessToken() {
  const providedToken = process.env.CWS_ACCESS_TOKEN?.trim();
  if (providedToken) return providedToken;

  const serviceAccount = requiredEnv("CWS_SERVICE_ACCOUNT_EMAIL");

  try {
    return execFileSync(
      "gcloud",
      [
        "auth",
        "print-access-token",
        `--impersonate-service-account=${serviceAccount}`,
        `--scopes=${CHROME_WEB_STORE_SCOPE}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ).trim();
  } catch {
    throw new Error(
      `Could not mint a Chrome Web Store token. Authenticate gcloud for ${serviceAccount} first.`,
    );
  }
}

function resourceName() {
  const publisherId = encodeURIComponent(requiredEnv("CWS_PUBLISHER_ID"));
  const extensionId = requiredEnv("CWS_EXTENSION_ID");
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("CWS_EXTENSION_ID must be the 32-character Chrome extension ID");
  }
  return `publishers/${publisherId}/items/${extensionId}`;
}

async function apiRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const details = body.error?.message ?? text ?? response.statusText;
    throw new Error(`Chrome Web Store API ${response.status}: ${details}`);
  }

  return body;
}

async function fetchStatus(name, token) {
  return apiRequest(`${API_ORIGIN}/v2/${name}:fetchStatus`, token);
}

function formatStatus(status) {
  const published = status.publishedItemRevisionStatus;
  const submitted = status.submittedItemRevisionStatus;
  return {
    publishedState: published?.state ?? "NONE",
    publishedVersions: storeVersions({ publishedItemRevisionStatus: published }),
    submittedState: submitted?.state ?? "NONE",
    submittedVersions: storeVersions({ submittedItemRevisionStatus: submitted }),
    lastUpload: status.lastAsyncUploadState ?? "NONE",
  };
}

async function packageJson() {
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

async function setPackageVersion(contents, version) {
  await writeFile(packageJsonPath, `${JSON.stringify({ ...contents, version }, null, 2)}\n`);
}

function createArtifact(version) {
  execFileSync("pnpm", ["exec", "wxt", "zip", "--mode", "production"], {
    cwd: packageRoot,
    stdio: "inherit",
  });

  return path.join(
    packageRoot,
    ".output",
    `volt-extension-${version}-chrome.zip`,
  );
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
}

async function verifyArtifact(version, artifactPath, buildConfig) {
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, ".output", "volt", "manifest.json"), "utf8"),
  );
  if (manifest.version !== version) {
    throw new Error(`Built manifest version ${manifest.version} does not match ${version}`);
  }
  if (manifest.key !== buildConfig.extensionPublicKey) {
    throw new Error("Built manifest omitted or changed WXT_EXTENSION_PUBLIC_KEY");
  }

  const outputFiles = await filesBelow(path.join(packageRoot, ".output", "volt"));
  const scripts = outputFiles.filter((file) => file.endsWith(".js"));
  const scriptContents = await Promise.all(
    scripts.map((file) => readFile(file, "utf8")),
  );
  if (!scriptContents.some((contents) => contents.includes(buildConfig.clerkPublishableKey))) {
    throw new Error("Built extension omitted WXT_CLERK_PUBLISHABLE_KEY");
  }
  await readFile(artifactPath);
}

async function upload(name, token, artifactPath) {
  const zip = await readFile(artifactPath);
  const result = await apiRequest(`${API_ORIGIN}/upload/v2/${name}:upload`, token, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: zip,
  });

  if (result.uploadState === "FAILED") {
    throw new Error("Chrome Web Store rejected the uploaded package");
  }

  if (result.uploadState === "IN_PROGRESS") {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const status = await fetchStatus(name, token);
      if (status.lastAsyncUploadState === "SUCCEEDED") return result;
      if (status.lastAsyncUploadState === "FAILED") {
        throw new Error("Chrome Web Store rejected the asynchronously uploaded package");
      }
    }
    throw new Error("Chrome Web Store upload is still processing after 60 seconds");
  }

  if (result.uploadState !== "SUCCEEDED") {
    throw new Error(`Unexpected Chrome Web Store upload state: ${result.uploadState}`);
  }

  return result;
}

async function publish(name, token, options) {
  return apiRequest(`${API_ORIGIN}/v2/${name}:publish`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publishType: options.publishType,
      skipReview: options.skipReview,
      blockOnWarnings: true,
    }),
  });
}

export async function submitExistingDraft(
  name,
  token,
  options,
  publishRequest = publish,
) {
  return publishRequest(name, token, options);
}

async function cancelSubmission(name, token) {
  return apiRequest(`${API_ORIGIN}/v2/${name}:cancelSubmission`, token, {
    method: "POST",
  });
}

export function parseOptions(args) {
  const publishTypeArg = args.find((arg) => arg.startsWith("--publish-type="));
  const publishType = publishTypeArg?.split("=")[1] ?? "DEFAULT_PUBLISH";
  if (!["DEFAULT_PUBLISH", "STAGED_PUBLISH"].includes(publishType)) {
    throw new Error("--publish-type must be DEFAULT_PUBLISH or STAGED_PUBLISH");
  }

  return {
    dryRun: args.includes("--dry-run"),
    uploadOnly: args.includes("--upload-only"),
    replacePending: args.includes("--replace-pending"),
    skipReview: args.includes("--skip-review"),
    publishType,
  };
}

export function parseSubmitExistingDraftOptions(args) {
  const unsupportedArg = args.find(
    (arg) =>
      arg !== "--skip-review" && !arg.startsWith("--publish-type="),
  );
  if (unsupportedArg) {
    throw new Error(
      `Unsupported submit-existing-draft option: ${unsupportedArg}`,
    );
  }

  const { publishType, skipReview } = parseOptions(args);
  return { publishType, skipReview };
}

async function run() {
  const [command = "release", ...args] = process.argv.slice(2);
  if (!["release", "status", "submit-existing-draft"].includes(command)) {
    throw new Error(
      "Usage: chrome-web-store.mjs <status|release|submit-existing-draft> [options]",
    );
  }

  const submitOptions =
    command === "submit-existing-draft"
      ? parseSubmitExistingDraftOptions(args)
      : undefined;
  const token = accessToken();
  const name = resourceName();

  if (command === "submit-existing-draft") {
    const publishResult = await submitExistingDraft(name, token, submitOptions);
    console.log(`Submitted existing draft: ${publishResult.state}`);
    return;
  }

  const status = await fetchStatus(name, token);

  if (command === "status") {
    console.log(JSON.stringify(formatStatus(status), null, 2));
    return;
  }

  const options = parseOptions(args);
  const originalPackage = await packageJson();
  const nextVersion = nextReleaseVersion(
    originalPackage.version,
    storeVersions(status),
  );
  console.log(`Next Chrome Web Store version: ${nextVersion}`);

  if (options.dryRun) return;
  const buildConfig = validateProductionBuildEnv(process.env);

  const submittedState = status.submittedItemRevisionStatus?.state;
  if (submittedState === "PENDING_REVIEW" && options.replacePending) {
    await cancelSubmission(name, token);
    console.log("Canceled the pending Chrome Web Store submission");
  } else if (["PENDING_REVIEW", "STAGED"].includes(submittedState)) {
    throw new Error(
      `The store already has a ${submittedState} submission. Wait for it or use --replace-pending when appropriate.`,
    );
  }

  let uploaded = false;
  try {
    await setPackageVersion(originalPackage, nextVersion);
    const artifactPath = createArtifact(nextVersion);
    await verifyArtifact(nextVersion, artifactPath, buildConfig);
    const uploadResult = await upload(name, token, artifactPath);
    uploaded = true;
    console.log(`Uploaded ${uploadResult.crxVersion ?? nextVersion}: ${artifactPath}`);

    if (!options.uploadOnly) {
      const publishResult = await publish(name, token, options);
      console.log(`Submitted ${nextVersion}: ${publishResult.state}`);
    }
  } finally {
    if (!uploaded) await setPackageVersion(originalPackage, originalPackage.version);
  }
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
