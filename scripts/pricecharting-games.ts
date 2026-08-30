#!/usr/bin/env bun
/**
 * PriceCharting game crawl driver for the Volt catalog.
 *
 * Discovers every game console from the video-games category page, paginates
 * each console's complete JSON product list, then fetches every game page and
 * feeds parsed UPC/details records to the Convex mutation
 * pricechartingCrawl:ingestGameDetails. Crawls are resumable via a JSON
 * state file, and dry-run mode never calls Convex.
 *
 * Cloudflare can start challenging bursts of requests. The driver detects
 * challenge pages and, by default (--browser auto), retries the blocked page
 * through headless system Chrome, which executes the challenge JavaScript
 * like a real browser.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseGamePage } from "../convex/catalog/pricecharting";

const execFileAsync = promisify(execFile);

const CATEGORY_URL = "https://www.pricecharting.com/category/video-games";
const USER_AGENT =
  "VoltCatalogBot/1.0 (+https://volt.juanquenga.com; contact: juan@juanquenga.com)";
const DEFAULT_DELAY_MS = 500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_STATE_PATH = "/tmp/pricecharting-crawl-state.json";
const CONVEX_MUTATION = "pricechartingCrawl:ingestGameDetails";
const DEFAULT_BATCH_SIZE = 20;
const VIDEO_GAME_SYSTEMS_MARKER = "Browse Popular Video Game Systems";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(scriptDir, "..");

interface ConsoleState {
  done: boolean;
  gamesDone: number;
  lastGameUrl: string | null;
}

interface CrawlState {
  consoles: Record<string, ConsoleState>;
}

interface IngestResult {
  itemsSeen: number;
  productsIngested: number;
  skippedNoUpc: number;
  skippedNoTitle: number;
  skippedInvalidSource: number;
  inserted: number;
  updated: number;
  sourcesAdded: number;
}

interface ConsoleRunStats {
  pagesFetched: number;
  gameLinks: number;
  parsedProducts: number;
  skippedNoUpc: number;
  inserted: number;
  updated: number;
  sourcesAdded: number;
  done: boolean;
  skippedAlreadyDone: boolean;
}

type BrowserMode = "auto" | "fetch" | "chrome";

interface CliOptions {
  consoles: string[] | null;
  maxGamesPerConsole: number;
  delayMs: number;
  batchSize: number;
  statePath: string;
  dryRun: boolean;
  browser: BrowserMode;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): { options: CliOptions | null; error: string | null } {
  const options: CliOptions = {
    consoles: null,
    maxGamesPerConsole: 0,
    delayMs: DEFAULT_DELAY_MS,
    batchSize: DEFAULT_BATCH_SIZE,
    statePath: DEFAULT_STATE_PATH,
    dryRun: false,
    browser: "auto",
  };
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    switch (arg) {
      case "--consoles": {
        const value = argv[index + 1];
        if (value === undefined) {
          return { options: null, error: "--consoles requires a comma-separated list of slugs" };
        }
        const slugs = value
          .split(",")
          .map((slug) => slug.trim())
          .filter((slug) => slug.length > 0);
        if (slugs.length === 0) {
          return { options: null, error: "--consoles requires at least one slug" };
        }
        options.consoles = slugs;
        index += 2;
        break;
      }
      case "--max-games": {
        const value = argv[index + 1];
        const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          return { options: null, error: "--max-games requires a positive integer" };
        }
        options.maxGamesPerConsole = parsed;
        index += 2;
        break;
      }
      case "--delay": {
        const value = argv[index + 1];
        const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 0) {
          return { options: null, error: "--delay requires a non-negative integer (ms)" };
        }
        options.delayMs = parsed;
        index += 2;
        break;
      }
      case "--batch": {
        const value = argv[index + 1];
        const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
          return { options: null, error: "--batch requires an integer between 1 and 50" };
        }
        options.batchSize = parsed;
        index += 2;
        break;
      }
      case "--state": {
        const value = argv[index + 1];
        if (value === undefined || value.length === 0) {
          return { options: null, error: "--state requires a file path" };
        }
        options.statePath = value;
        index += 2;
        break;
      }
      case "--browser": {
        const value = argv[index + 1];
        if (value !== "auto" && value !== "fetch" && value !== "chrome") {
          return { options: null, error: "--browser requires auto, fetch, or chrome" };
        }
        options.browser = value;
        index += 2;
        break;
      }
      case "--dry-run":
        options.dryRun = true;
        index += 1;
        break;
      default:
        return { options: null, error: "unknown argument: " + arg };
    }
  }
  return { options, error: null };
}

function printUsage(): void {
  const lines: string[] = [
    "PriceCharting game crawl driver",
    "",
    "Usage: bun scripts/pricecharting-games.ts [options]",
    "",
    "Options:",
    "  --consoles <slugs>   Comma-separated console slugs to crawl (e.g.",
    "                       nintendo-64,super-nintendo). Omit to crawl every",
    "                       console listed under /category/video-games.",
    "  --max-games <n>      Stop each console after n game pages this run",
    "                       (resumable). Default: unlimited.",
    "  --delay <ms>         Minimum delay between requests. Default: 500.",
    "  --batch <n>          Game records per Convex ingest call (1-50).",
    "                       Default: 20.",
    "  --state <path>       Resume state file. Default: " + DEFAULT_STATE_PATH,
    "  --browser <mode>     auto (default): plain fetch, retry blocks with",
    "                       headless Chrome. fetch: never use Chrome.",
    "                       chrome: always use Chrome.",
    "  --dry-run            Fetch, parse, and log without calling Convex.",
    "  --help               Show this help.",
    "",
    "Environment:",
    "  PRICECHARTING_CRAWL_SECRET   Crawl secret (falls back to",
    "                               INVENTORY_CRAWL_SECRET). Required for",
    "                               real (non-dry-run) crawls.",
    "  CHROME_BIN                   Path to a Chrome/Chromium binary for",
    "                               --browser auto/chrome.",
  ];
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Secrets (process env first, then repo-root .env.local fallback)
// ---------------------------------------------------------------------------

function parseEnvFile(path: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!existsSync(path)) return vars;
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[env] could not read " + path + ": " + message);
    return vars;
  }
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const raw = line.slice(eq + 1).trim();
    const quote = raw.charAt(0);
    const unquoted =
      raw.length >= 2 && quote === raw.charAt(raw.length - 1) &&
      (quote === String.fromCharCode(34) || quote === String.fromCharCode(39))
        ? raw.slice(1, -1)
        : raw;
    if (key.length > 0 && unquoted.length > 0) vars[key] = unquoted;
  }
  return vars;
}

function resolveSecret(envFileVars: Record<string, string>): string {
  const fromEnv =
    (process.env.PRICECHARTING_CRAWL_SECRET ?? process.env.INVENTORY_CRAWL_SECRET ?? "").trim();
  if (fromEnv.length > 0) return fromEnv;
  return (
    envFileVars["PRICECHARTING_CRAWL_SECRET"] ?? envFileVars["INVENTORY_CRAWL_SECRET"] ?? ""
  ).trim();
}

export function redactSecret(value: string, secret: string): string {
  return secret ? value.split(secret).join("[REDACTED]") : value;
}

// ---------------------------------------------------------------------------
// HTTP with politeness, retries, and challenge detection
// ---------------------------------------------------------------------------

let lastRequestAt = 0;
let consecutiveChallenges = 0;

const CHALLENGE_MARKERS = /challenge-platform|_cf_chl\b|cf-error-details|attention required/i;

export function looksLikeChallenge(status: number, body: string): boolean {
  if (CHALLENGE_MARKERS.test(body)) return true;
  return (status === 403 || status === 503) && body.length < 50_000;
}

function chromeBinaryPath(): string | null {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Headless Chrome executes the page's JavaScript, which is what Cloudflare's
// non-interactive challenges need; --dump-dom then prints the settled DOM.
async function fetchViaChrome(url: string): Promise<string> {
  const chrome = chromeBinaryPath();
  if (chrome === null) {
    throw new Error(
      "no Chrome binary found (set CHROME_BIN); cannot run --browser chrome",
    );
  }
  const result = await execFileAsync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--user-data-dir=" + resolvePath("/tmp", "pricecharting-chrome-profile"),
      "--virtual-time-budget=20000",
      "--timeout=" + REQUEST_TIMEOUT_MS,
      "--dump-dom",
      url,
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: REQUEST_TIMEOUT_MS + 15_000 },
  );
  const dom = result.stdout;
  if (dom.length === 0) throw new Error("chrome returned an empty DOM");
  if (looksLikeChallenge(200, dom)) throw new ChallengeError(200);
  const requestedUrl = new URL(url);
  if (requestedUrl.searchParams.get("format") === "json") {
    const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(dom);
    if (bodyMatch?.[1] === undefined) {
      throw new Error("chrome returned JSON without a body element");
    }
    const serializedBody = bodyMatch[1].trim();
    const preMatch = /^<pre[^>]*>([\s\S]*)<\/pre>$/i.exec(serializedBody);
    return decodeHtmlEntities(preMatch?.[1] ?? serializedBody);
  }
  return dom;
}

class ChallengeError extends Error {
  constructor(readonly status: number) {
    super("blocked by challenge (HTTP " + status + ")");
    this.name = "ChallengeError";
  }
}

export interface FetchOutcome {
  body: string;
  finalUrl: string;
}

async function politeWait(delayMs: number): Promise<void> {
  const waitMs = delayMs - (Date.now() - lastRequestAt);
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
}

async function fetchOnce(url: string, mode: BrowserMode): Promise<FetchOutcome> {
  if (mode === "chrome") {
    return { body: await fetchViaChrome(url), finalUrl: url };
  }
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "follow",
  });
  const body = await response.text();
  if (looksLikeChallenge(response.status, body)) {
    throw new ChallengeError(response.status);
  }
  if (!response.ok) {
    throw new Error("HTTP " + response.status + " " + response.statusText);
  }
  return { body, finalUrl: response.url || url };
}

export async function fetchPage(
  url: string,
  options: CliOptions,
  description: string,
  validateBody?: (body: string) => void,
): Promise<FetchOutcome> {
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      console.warn(
        "[" + description + "] retry " + attempt + "/" + MAX_RETRIES + " (" + lastError + ")",
      );
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
    await politeWait(options.delayMs);
    const useChrome = options.browser === "chrome" ||
      (options.browser === "auto" && consecutiveChallenges >= 3);
    try {
      const outcome = await fetchOnce(url, useChrome ? "chrome" : "fetch");
      validateBody?.(outcome.body);
      consecutiveChallenges = 0;
      return outcome;
    } catch (error) {
      if (error instanceof ChallengeError) {
        consecutiveChallenges += 1;
        lastError = error.message;
        if (options.browser === "fetch") throw error;
        if (consecutiveChallenges === 3) {
          console.warn(
            "[cloudflare] repeated challenges; switching blocked requests to headless Chrome",
          );
        }
      } else {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  throw new Error(
    description + " failed after " + (MAX_RETRIES + 1) + " attempts: " + lastError,
  );
}

// ---------------------------------------------------------------------------
// Page extraction (console discovery, paginated product links)
// ---------------------------------------------------------------------------

const CONSOLE_LINK =
  /href="(?:https:\/\/www\.pricecharting\.com)?\/console\/([^"?]+)(?:\?[^"]*)?"/g;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, String.fromCharCode(34))
    .replace(/&#39;|&apos;/g, String.fromCharCode(39));
}

export function extractConsoleSlugs(categoryHtml: string): string[] {
  const markerIndex = categoryHtml.indexOf(VIDEO_GAME_SYSTEMS_MARKER);
  if (markerIndex < 0) {
    throw new Error(
      "category page is missing the '" + VIDEO_GAME_SYSTEMS_MARKER + "' section",
    );
  }
  const systemsHtml = categoryHtml.slice(markerIndex);
  const slugs = new Set<string>();
  for (const match of systemsHtml.matchAll(CONSOLE_LINK)) {
    const rawSlug = match[1];
    if (rawSlug === undefined) continue;
    const slug = decodeHtmlEntities(rawSlug).trim();
    if (slug.length > 0 && !slug.includes("/")) slugs.add(slug);
  }
  return [...slugs].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathSegment(value: string): boolean {
  return value.length > 0 && !/[/?#\u0000-\u001f\u007f]/.test(value);
}

export function parseConsoleProductsPayload(body: string): {
  cursor: string | null;
  gameUrls: string[];
} {
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) throw new Error("console products payload must be an object");

  const rawProducts = parsed["products"];
  if (!Array.isArray(rawProducts)) {
    throw new Error("console products payload must contain a products array");
  }

  const rawCursor = parsed["cursor"];
  let cursor: string | null;
  if (rawCursor === undefined || rawCursor === null || rawCursor === "") {
    cursor = null;
  } else if (typeof rawCursor === "string") {
    cursor = rawCursor.trim() || null;
  } else {
    throw new Error("console products payload cursor must be a string or null");
  }

  const gameUrls = new Set<string>();
  for (const [index, rawProduct] of rawProducts.entries()) {
    if (!isRecord(rawProduct)) {
      throw new Error("console products payload row " + index + " must be an object");
    }
    const rawConsoleUri = rawProduct["consoleUri"];
    const rawProductUri = rawProduct["productUri"];
    if (typeof rawConsoleUri !== "string" || typeof rawProductUri !== "string") {
      throw new Error(
        "console products payload row " + index + " must contain string URI fields",
      );
    }
    const consoleUri = rawConsoleUri.trim();
    const productUri = rawProductUri.trim();
    if (!isPathSegment(consoleUri) || !isPathSegment(productUri)) {
      throw new Error(
        "console products payload row " + index + " contains an invalid URI field",
      );
    }
    gameUrls.add(
      "https://www.pricecharting.com/game/" + consoleUri + "/" + productUri,
    );
  }
  return { cursor, gameUrls: [...gameUrls] };
}

async function fetchConsoleSlugs(options: CliOptions): Promise<string[]> {
  if (options.consoles !== null) return options.consoles;
  console.log("[category] fetching console list from " + CATEGORY_URL);
  const page = await fetchPage(CATEGORY_URL, options, "category");
  const slugs = extractConsoleSlugs(page.body);
  if (slugs.length === 0) throw new Error("no console slugs found on the category page");
  console.log("[category] found " + slugs.length + " consoles");
  return slugs;
}

async function fetchConsoleGameUrls(consoleSlug: string, options: CliOptions): Promise<string[]> {
  const urls = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = "0";
  while (cursor !== null) {
    if (seenCursors.has(cursor)) {
      throw new Error("console products pagination repeated cursor " + cursor);
    }
    seenCursors.add(cursor);
    const url = new URL("https://www.pricecharting.com/console/" + consoleSlug);
    url.searchParams.set("sort", "name");
    url.searchParams.set("when", "none");
    url.searchParams.set("cursor", cursor);
    url.searchParams.set("format", "json");
    const description = consoleSlug + " products (cursor " + cursor + ")";
    const page = await fetchPage(
      url.toString(),
      options,
      description,
      (body) => {
        parseConsoleProductsPayload(body);
      },
    );
    const payload = parseConsoleProductsPayload(page.body);
    for (const gameUrl of payload.gameUrls) urls.add(gameUrl);
    cursor = payload.cursor;
  }
  return [...urls].sort();
}

// ---------------------------------------------------------------------------
// Convex ingestion (single well-named entry point, with dry-run mode)
// ---------------------------------------------------------------------------

function isIngestResult(value: unknown): value is IngestResult {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
  if (record === null) return false;
  const numericKeys = [
    "itemsSeen",
    "productsIngested",
    "skippedNoUpc",
    "skippedNoTitle",
    "skippedInvalidSource",
    "inserted",
    "updated",
    "sourcesAdded",
  ] as const;
  return numericKeys.every((key) => {
    const raw = record[key];
    return typeof raw === "number" && Number.isFinite(raw);
  });
}

// "convex run" prints function logs before the return value, which may be
// pretty-printed across multiple lines. Try each line-starting "{" from the
// bottom up, parsing from that brace to the end of stdout.
function parseConvexReturnValue(stdout: string): IngestResult | null {
  let searchFrom = stdout.length;
  try {
    const whole: unknown = JSON.parse(stdout);
    if (isIngestResult(whole)) return whole;
  } catch {
    // Mixed output; fall through to brace scanning.
  }
  for (;;) {
    const braceIndex = stdout.lastIndexOf("\n{", searchFrom - 1);
    if (braceIndex < 0) return null;
    searchFrom = braceIndex;
    try {
      const parsed: unknown = JSON.parse(stdout.slice(braceIndex + 1));
      if (isIngestResult(parsed)) return parsed;
    } catch {
      // Not a complete JSON object from this brace; try an earlier one.
    }
  }
}

function tail(value: string, maxChars = 2_000): string {
  const trimmed = value.trimEnd();
  return trimmed.length > maxChars ? "..." + trimmed.slice(-maxChars) : trimmed;
}

async function ingestGameDetails(
  items: Record<string, unknown>[],
  secret: string,
  options: CliOptions,
): Promise<IngestResult> {
  if (options.dryRun) {
    return {
      itemsSeen: items.length,
      productsIngested: 0,
      skippedNoUpc: 0,
      skippedNoTitle: 0,
      skippedInvalidSource: 0,
      inserted: 0,
      updated: 0,
      sourcesAdded: 0,
    };
  }
  const argsJson = JSON.stringify({ secret, items });
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(
      "pnpm",
      ["exec", "convex", "run", "--prod", CONVEX_MUTATION, argsJson],
      { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 },
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const shaped = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    stdout = typeof shaped.stdout === "string" ? shaped.stdout : stdout;
    stderr = typeof shaped.stderr === "string" ? shaped.stderr : stderr;
    const rawMessage = typeof shaped.message === "string" ? shaped.message : String(error);
    throw new Error(
      "convex run failed: " +
        redactSecret(rawMessage, secret) +
        "\n--- stdout (tail) ---\n" +
        tail(redactSecret(stdout, secret)) +
        "\n--- stderr (tail) ---\n" +
        tail(redactSecret(stderr, secret)),
    );
  }
  const parsed = parseConvexReturnValue(stdout);
  if (parsed === null) {
    throw new Error(
      "could not parse " + CONVEX_MUTATION + " return value from convex run output" +
        "\n--- stdout (tail) ---\n" + tail(stdout) +
        "\n--- stderr (tail) ---\n" + tail(stderr),
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------

function freshConsoleState(): ConsoleState {
  return { done: false, gamesDone: 0, lastGameUrl: null };
}

function narrowCrawlState(value: unknown): CrawlState | null {
  const root = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
  if (root === null) return null;
  const consolesRaw = root["consoles"];
  if (typeof consolesRaw !== "object" || consolesRaw === null || Array.isArray(consolesRaw)) return null;
  const consoles: Record<string, ConsoleState> = {};
  for (const [slug, rawState] of Object.entries(consolesRaw as Record<string, unknown>)) {
    const record = typeof rawState === "object" && rawState !== null && !Array.isArray(rawState)
      ? (rawState as Record<string, unknown>)
      : null;
    if (record === null) continue;
    const lastGameUrl = record["lastGameUrl"];
    consoles[slug] = {
      done: record["done"] === true,
      gamesDone:
        typeof record["gamesDone"] === "number" && Number.isFinite(record["gamesDone"])
          ? record["gamesDone"]
          : 0,
      lastGameUrl: typeof lastGameUrl === "string" && lastGameUrl.length > 0 ? lastGameUrl : null,
    };
  }
  return { consoles };
}

function loadState(path: string): CrawlState {
  if (!existsSync(path)) return { consoles: {} };
  try {
    const narrowed = narrowCrawlState(JSON.parse(readFileSync(path, "utf8")) as unknown);
    if (narrowed !== null) return narrowed;
    console.warn("[state] " + path + " has an unexpected shape; starting fresh");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[state] could not read " + path + " (" + message + "); starting fresh");
  }
  return { consoles: {} };
}

function saveState(path: string, state: CrawlState): void {
  const dir = dirname(path);
  if (dir.length > 0 && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmpPath, path);
}

// ---------------------------------------------------------------------------
// Crawl loop
// ---------------------------------------------------------------------------

async function crawlConsole(input: {
  slug: string;
  options: CliOptions;
  secret: string;
  state: CrawlState;
}): Promise<ConsoleRunStats> {
  const { slug, options } = input;
  const saved = input.state.consoles[slug] ?? freshConsoleState();
  if (saved.done) {
    console.log("[" + slug + "] already marked done in state; skipping");
    return {
      pagesFetched: 0,
      gameLinks: 0,
      parsedProducts: 0,
      skippedNoUpc: 0,
      inserted: 0,
      updated: 0,
      sourcesAdded: 0,
      done: true,
      skippedAlreadyDone: true,
    };
  }

  const stats: ConsoleRunStats = {
    pagesFetched: 0,
    gameLinks: 0,
    parsedProducts: 0,
    skippedNoUpc: 0,
    inserted: 0,
    updated: 0,
    sourcesAdded: 0,
    done: false,
    skippedAlreadyDone: false,
  };

  const gameUrls = await fetchConsoleGameUrls(slug, options);
  stats.gameLinks = gameUrls.length;

  // Resume position: prefer the exact last-ingested URL, fall back to the
  // ingested count when the console page's ordering shifted between runs.
  let startIndex = 0;
  if (saved.lastGameUrl !== null) {
    const markerIndex = gameUrls.indexOf(saved.lastGameUrl);
    startIndex = markerIndex >= 0 ? markerIndex + 1 : saved.gamesDone;
  } else if (saved.gamesDone > 0) {
    startIndex = saved.gamesDone;
  }
  if (startIndex >= gameUrls.length) {
    if (!options.dryRun) {
      input.state.consoles[slug] = { ...saved, done: true };
      saveState(options.statePath, input.state);
    }
    stats.done = true;
    return stats;
  }
  if (startIndex > 0) {
    console.log("[" + slug + "] resuming at game " + (startIndex + 1) + " of " + gameUrls.length);
  }

  let batch: Record<string, unknown>[] = [];
  let processedThisRun = 0;
  let stoppedEarly = false;
  let pendingCheckpoint: { gamesDone: number; lastGameUrl: string } | null = null;
  let durableGamesDone = saved.gamesDone;
  let durableLastGameUrl = saved.lastGameUrl;

  const flushBatch = async (): Promise<void> => {
    if (batch.length === 0) return;
    const checkpoint = pendingCheckpoint;
    if (checkpoint === null) {
      throw new Error("cannot flush a batch without a checkpoint");
    }
    if (options.dryRun) {
      console.log(
        "[" + slug + "] batch of " + batch.length
          + " records ready (dry-run; skipping Convex)",
      );
    } else {
      const ingest = await ingestGameDetails(batch, input.secret, options);
      stats.inserted += ingest.inserted;
      stats.updated += ingest.updated;
      stats.sourcesAdded += ingest.sourcesAdded;
      console.log(
        "[" + slug + "] ingested " + batch.length + " records (+"
          + ingest.inserted + " new, " + ingest.updated + " updated)",
      );
      durableGamesDone = checkpoint.gamesDone;
      durableLastGameUrl = checkpoint.lastGameUrl;
      input.state.consoles[slug] = {
        done: false,
        gamesDone: durableGamesDone,
        lastGameUrl: durableLastGameUrl,
      };
      saveState(options.statePath, input.state);
    }
    batch = [];
    pendingCheckpoint = null;
  };

  for (let gameIndex = startIndex; gameIndex < gameUrls.length; gameIndex += 1) {
    if (options.maxGamesPerConsole > 0 && processedThisRun >= options.maxGamesPerConsole) {
      console.log(
        "[" + slug + "] reached --max-games " + options.maxGamesPerConsole
          + "; stopping this run (resumable)",
      );
      stoppedEarly = true;
      break;
    }

    const gameUrl = gameUrls[gameIndex];
    if (gameUrl === undefined) break;
    const page = await fetchPage(gameUrl, options, gameUrl);
    stats.pagesFetched += 1;
    processedThisRun += 1;

    const record = parseGamePage(page.body, page.finalUrl);
    if (record === null) {
      stats.skippedNoUpc += 1;
    } else {
      stats.parsedProducts += 1;
      batch.push(record as unknown as Record<string, unknown>);
      pendingCheckpoint = { gamesDone: gameIndex + 1, lastGameUrl: gameUrl };
      if (batch.length >= options.batchSize) await flushBatch();
    }
  }

  await flushBatch();
  stats.done = !stoppedEarly;
  if (!options.dryRun) {
    input.state.consoles[slug] = {
      done: !stoppedEarly,
      gamesDone: stoppedEarly ? durableGamesDone : gameUrls.length,
      lastGameUrl: stoppedEarly
        ? durableLastGameUrl
        : (gameUrls[gameUrls.length - 1] ?? null),
    };
    saveState(options.statePath, input.state);
  }
  return stats;
}

function printSummary(perConsole: Map<string, ConsoleRunStats>, elapsedMs: number, dryRun: boolean): void {
  const columns = ["console", "pages", "games", "parsed", "noUpc", "inserted", "updated", "sources", "done"] as const;
  const rows: string[][] = [];
  const totals = { pages: 0, games: 0, parsed: 0, noUpc: 0, inserted: 0, updated: 0, sources: 0 };
  for (const [slug, stats] of perConsole) {
    totals.pages += stats.pagesFetched;
    totals.games += stats.gameLinks;
    totals.parsed += stats.parsedProducts;
    totals.noUpc += stats.skippedNoUpc;
    totals.inserted += stats.inserted;
    totals.updated += stats.updated;
    totals.sources += stats.sourcesAdded;
    rows.push([
      stats.skippedAlreadyDone ? slug + " (done)" : slug,
      String(stats.pagesFetched),
      String(stats.gameLinks),
      String(stats.parsedProducts),
      String(stats.skippedNoUpc),
      String(stats.inserted),
      String(stats.updated),
      String(stats.sourcesAdded),
      stats.done ? "yes" : "no",
    ]);
  }
  rows.push([
    "TOTAL",
    String(totals.pages),
    String(totals.games),
    String(totals.parsed),
    String(totals.noUpc),
    String(totals.inserted),
    String(totals.updated),
    String(totals.sources),
    "",
  ]);

  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index].length)),
  );
  const renderRow = (row: string[]): string =>
    columns.map((column, index) => row[index].padEnd(widths[index])).join("  ").trimEnd();

  console.log("");
  console.log(renderRow([...columns]));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(renderRow(row));
  console.log("");
  console.log(
    "done in " + (elapsedMs / 1000).toFixed(1) + "s" +
      (dryRun ? " (dry-run; no Convex calls)" : ""),
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.some((arg) => arg === "--help" || arg === "-h")) {
    printUsage();
    return 0;
  }
  const { options, error } = parseCliArgs(argv);
  if (options === null) {
    console.error("error: " + (error ?? "invalid arguments"));
    printUsage();
    return 2;
  }

  const envFileVars = parseEnvFile(resolvePath(repoRoot, ".env.local"));
  const secret = resolveSecret(envFileVars);
  if (options.dryRun) {
    if (secret.length === 0) {
      console.warn("[secret] crawl secret is not set; dry-run proceeds without Convex");
    }
  } else if (secret.length === 0) {
    console.error(
      "error: PRICECHARTING_CRAWL_SECRET (or INVENTORY_CRAWL_SECRET) is not set. " +
        "Export it or add it to .env.local in the repo root, then rerun. " +
        "Use --dry-run to crawl without Convex.",
    );
    return 1;
  }

  const state = loadState(options.statePath);
  const startedAt = Date.now();
  const slugs = await fetchConsoleSlugs(options);
  const perConsole = new Map<string, ConsoleRunStats>();

  for (const [index, slug] of slugs.entries()) {
    const stats = await crawlConsole({ slug, options, secret, state });
    perConsole.set(slug, stats);
    if (index < slugs.length - 1) await sleep(options.delayMs);
  }

  printSummary(perConsole, Date.now() - startedAt, options.dryRun);
  return 0;
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  fileURLToPath(import.meta.url) === resolvePath(invokedPath)
) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      console.error("fatal: " + (error instanceof Error ? error.message : String(error)));
      process.exit(1);
    });
}
