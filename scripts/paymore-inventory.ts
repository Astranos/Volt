#!/usr/bin/env bun
/**
 * PayMore inventory crawl driver for the Volt catalog.
 *
 * Pages through the PayMore shop API collection by collection and feeds every
 * fetched item to the Convex mutation paymoreCrawl:ingestInventoryPage.
 * Crawls are resumable via a JSON state file, and a dry-run mode fetches and
 * logs pages without ever calling Convex.
 */

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const API_URL = "https://pm.paymore.tech/api/user/shop/products";
const SITEMAP_URL = "https://paymore.com/sitemap/shop-categories.xml";
const USER_AGENT =
  "VoltCatalogBot/1.0 (+https://volt.juanquenga.com; contact: juan@juanquenga.com)";
const PAGE_LIMIT = 20;
const POLITE_DELAY_MS = 400;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_STATE_PATH = "/tmp/paymore-crawl-state.json";
const CONVEX_MUTATION = "paymoreCrawl:ingestInventoryPage";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(scriptDir, "..");

type ApiItem = Record<string, unknown>;

interface PayMoreProductsPage {
  data: ApiItem[];
  next: string | null;
}

interface CollectionState {
  nextToken: string | null;
  done: boolean;
  pagesDone: number;
  itemsSeen: number;
}

interface CrawlState {
  collections: Record<string, CollectionState>;
}

interface IngestResult {
  itemsSeen: number;
  productsIngested: number;
  skippedNoUpc: number;
  skippedNoTitle: number;
  inserted: number;
  updated: number;
  sourcesAdded: number;
}

interface IngestInput {
  collectionSlug: string;
  items: unknown[];
  secret: string;
  dryRun: boolean;
}

interface CollectionRunStats {
  pagesFetched: number;
  itemsSeen: number;
  productsIngested: number;
  inserted: number;
  updated: number;
  sourcesAdded: number;
  done: boolean;
  skippedAlreadyDone: boolean;
}

interface CliOptions {
  /** Null means: derive the collection list from the sitemap. */
  collections: string[] | null;
  /** 0 means unlimited. */
  maxPages: number;
  statePath: string;
  dryRun: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function itemTitle(item: ApiItem): string | null {
  const title = item["p_title"];
  return typeof title === "string" && title.trim().length > 0 ? title : null;
}

// Convex object keys must be printable ASCII. PayMore occasionally emits
// labels with tabs or other control characters, so normalize those keys at
// the network boundary before the raw API page crosses into Convex.
export function sanitizeConvexValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeConvexValue);
  const record = asRecord(value);
  if (record === null) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [rawKey, entry] of Object.entries(record)) {
    const key = rawKey
      .replace(/[^\x20-\x7e]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!key || key.startsWith("$")) continue;
    sanitized[key] = sanitizeConvexValue(entry);
  }
  return sanitized;
}

export function redactSecret(value: string, secret: string): string {
  return secret ? value.split(secret).join("[REDACTED]") : value;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): {
  options: CliOptions | null;
  error: string | null;
} {
  const options: CliOptions = {
    collections: null,
    maxPages: 0,
    statePath: DEFAULT_STATE_PATH,
    dryRun: false,
  };
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    switch (arg) {
      case "--collections": {
        const value = argv[index + 1];
        if (value === undefined) {
          return {
            options: null,
            error: "--collections requires a comma-separated list of slugs",
          };
        }
        const slugs = value
          .split(",")
          .map((slug) => slug.trim())
          .filter((slug) => slug.length > 0);
        if (slugs.length === 0) {
          return {
            options: null,
            error: "--collections requires at least one slug",
          };
        }
        options.collections = slugs;
        index += 2;
        break;
      }
      case "--max-pages": {
        const value = argv[index + 1];
        const parsed =
          value === undefined ? Number.NaN : Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          return {
            options: null,
            error: "--max-pages requires a positive integer",
          };
        }
        options.maxPages = parsed;
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
    "PayMore inventory crawl driver",
    "",
    "Usage: bun scripts/paymore-inventory.ts [options]",
    "",
    "Options:",
    "  --collections <slugs>  Comma-separated collection slugs to crawl.",
    "                         Omit to derive the full list from the PayMore",
    "                         sitemap (shop-categories.xml).",
    "  --max-pages <n>        Stop each collection after n pages this run.",
    "                         Default: unlimited (crawl until the API is",
    "                         exhausted).",
    "  --state <path>         Path of the resume state file.",
    "                         Default: /tmp/paymore-crawl-state.json",
    "  --dry-run              Fetch and log pages, but skip all Convex calls.",
    "  --help                 Show this help.",
    "",
    "Environment:",
    "  INVENTORY_CRAWL_SECRET  Required for real (non-dry-run) crawls. Read",
    "                          from the environment, or from the repo-root",
    "                          .env.local.",
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
  const fromEnv = (process.env.INVENTORY_CRAWL_SECRET ?? "").trim();
  if (fromEnv.length > 0) return fromEnv;
  return (envFileVars["INVENTORY_CRAWL_SECRET"] ?? "").trim();
}

// ---------------------------------------------------------------------------
// HTTP with politeness + retries
// ---------------------------------------------------------------------------

let lastPayMoreRequestAt = 0;

async function fetchTextWithRetry(
  url: string,
  headers: Record<string, string>,
  description: string,
): Promise<string> {
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      console.warn(
        "[" +
          description +
          "] retry " +
          attempt +
          "/" +
          MAX_RETRIES +
          " (last error: " +
          lastError +
          ")",
      );
      await sleep(RETRY_BACKOFF_MS);
    }
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return await response.text();
      lastError = "HTTP " + response.status + " " + response.statusText;
      await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(
    description +
      " failed after " +
      (MAX_RETRIES + 1) +
      " attempts: " +
      lastError,
  );
}

function parseProductsResponse(payload: unknown): PayMoreProductsPage {
  const envelope = asRecord(payload);
  const data = envelope === null ? null : asRecord(envelope["data"]);
  if (data === null) {
    throw new Error("unexpected PayMore response shape: missing data object");
  }
  const itemsRaw = data["data"];
  if (!Array.isArray(itemsRaw)) {
    throw new Error(
      "unexpected PayMore response shape: data.data is not an array",
    );
  }
  const items: ApiItem[] = [];
  for (const entry of itemsRaw) {
    const record = asRecord(entry);
    if (record !== null) items.push(record);
  }
  const nextRaw = data["next"];
  const next =
    typeof nextRaw === "string" && nextRaw.length > 0 ? nextRaw : null;
  return { data: items, next };
}

async function fetchProductsPage(
  slug: string,
  nextToken: string | null,
): Promise<PayMoreProductsPage> {
  const url = new URL(API_URL);
  url.searchParams.set("country_code", "US");
  url.searchParams.set("collectionSearch", slug);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  if (nextToken !== null) url.searchParams.set("next", nextToken);

  // Politeness: never send two requests to pm.paymore.tech less than
  // POLITE_DELAY_MS apart.
  const waitMs = POLITE_DELAY_MS - (Date.now() - lastPayMoreRequestAt);
  if (waitMs > 0) await sleep(waitMs);
  lastPayMoreRequestAt = Date.now();

  const body = await fetchTextWithRetry(
    url.toString(),
    { Accept: "application/json", "User-Agent": USER_AGENT },
    slug,
  );
  try {
    return parseProductsResponse(JSON.parse(body) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("[" + slug + "] API returned invalid JSON: " + message);
  }
}

function extractSlugsFromSitemap(xml: string): string[] {
  const prefix = "https://paymore.com/shop/category/";
  const slugs = new Set<string>();
  for (const chunk of xml.split("<loc>")) {
    const end = chunk.indexOf("</loc>");
    if (end < 0) continue;
    const loc = chunk.slice(0, end).trim();
    if (!loc.startsWith(prefix)) continue;
    let slug = loc.slice(prefix.length);
    if (slug.endsWith("/")) slug = slug.slice(0, -1);
    if (slug.length === 0 || slug.includes("/")) continue;
    slugs.add(slug);
  }
  return [...slugs].sort();
}

async function fetchCollectionSlugs(): Promise<string[]> {
  const xml = await fetchTextWithRetry(
    SITEMAP_URL,
    {
      Accept: "application/xml, text/xml;q=0.9, */*;q=0.8",
      "User-Agent": USER_AGENT,
    },
    "sitemap",
  );
  return extractSlugsFromSitemap(xml);
}

// ---------------------------------------------------------------------------
// Convex ingestion (single well-named entry point, with dry-run mode)
// ---------------------------------------------------------------------------

function isIngestResult(value: unknown): value is IngestResult {
  const record = asRecord(value);
  if (record === null) return false;
  const numericKeys = [
    "itemsSeen",
    "productsIngested",
    "skippedNoUpc",
    "skippedNoTitle",
    "inserted",
    "updated",
    "sourcesAdded",
  ] as const;
  return numericKeys.every((key) => {
    const raw = record[key];
    return typeof raw === "number" && Number.isFinite(raw);
  });
}

/**
 * "convex run" prints function logs before the return value, which may be
 * pretty-printed across multiple lines. Try each line-starting "{" from the
 * bottom up, parsing from that brace to the end of stdout.
*/
function parseConvexReturnValue(stdout: string): IngestResult | null {
  let searchFrom = stdout.length;
  // The value may be the entire stdout starting at byte 0 (no logs before it).
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

async function ingestInventoryPage(input: IngestInput): Promise<IngestResult> {
  if (input.dryRun) {
    console.log(
      "[convex] dry-run: skipping " +
        CONVEX_MUTATION +
        " for " +
        input.collectionSlug +
        " (" +
        input.items.length +
        " items)",
    );
    return {
      itemsSeen: input.items.length,
      productsIngested: 0,
      skippedNoUpc: 0,
      skippedNoTitle: 0,
      inserted: 0,
      updated: 0,
      sourcesAdded: 0,
    };
  }

  const argsJson = JSON.stringify({
    secret: input.secret,
    collectionSlug: input.collectionSlug,
    items: input.items.map(sanitizeConvexValue),
  });

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
    const shaped = error as {
      stdout?: unknown;
      stderr?: unknown;
      message?: unknown;
    };
    stdout = typeof shaped.stdout === "string" ? shaped.stdout : stdout;
    stderr = typeof shaped.stderr === "string" ? shaped.stderr : stderr;
    const rawMessage =
      typeof shaped.message === "string" ? shaped.message : String(error);
    const message = redactSecret(rawMessage, input.secret);
    throw new Error(
      "convex run failed: " +
        message +
        "\n--- stdout (tail) ---\n" +
        tail(redactSecret(stdout, input.secret)) +
        "\n--- stderr (tail) ---\n" +
        tail(redactSecret(stderr, input.secret)),
    );
  }

  const parsed = parseConvexReturnValue(stdout);
  if (parsed === null) {
    throw new Error(
      "could not parse " +
        CONVEX_MUTATION +
        " return value from convex run output" +
        "\n--- stdout (tail) ---\n" +
        tail(stdout) +
        "\n--- stderr (tail) ---\n" +
        tail(stderr),
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------

function freshCollectionState(): CollectionState {
  return { nextToken: null, done: false, pagesDone: 0, itemsSeen: 0 };
}

function narrowCrawlState(value: unknown): CrawlState | null {
  const root = asRecord(value);
  if (root === null) return null;
  const collectionsRaw = asRecord(root["collections"]);
  if (collectionsRaw === null) return null;
  const collections: Record<string, CollectionState> = {};
  for (const [slug, rawState] of Object.entries(collectionsRaw)) {
    const record = asRecord(rawState);
    if (record === null) continue;
    const nextTokenRaw = record["nextToken"];
    const pagesDoneRaw = record["pagesDone"];
    const itemsSeenRaw = record["itemsSeen"];
    collections[slug] = {
      nextToken:
        typeof nextTokenRaw === "string" && nextTokenRaw.length > 0
          ? nextTokenRaw
          : null,
      done: record["done"] === true,
      pagesDone:
        typeof pagesDoneRaw === "number" && Number.isFinite(pagesDoneRaw)
          ? pagesDoneRaw
          : 0,
      itemsSeen:
        typeof itemsSeenRaw === "number" && Number.isFinite(itemsSeenRaw)
          ? itemsSeenRaw
          : 0,
    };
  }
  return { collections };
}

function loadState(path: string): CrawlState {
  if (!existsSync(path)) return { collections: {} };
  try {
    const narrowed = narrowCrawlState(
      JSON.parse(readFileSync(path, "utf8")) as unknown,
    );
    if (narrowed !== null) return narrowed;
    console.warn("[state] " + path + " has an unexpected shape; starting fresh");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      "[state] could not read " + path + " (" + message + "); starting fresh",
    );
  }
  return { collections: {} };
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

async function crawlCollection(input: {
  slug: string;
  options: CliOptions;
  secret: string;
  state: CrawlState;
}): Promise<CollectionRunStats> {
  const { slug, options } = input;
  const saved = input.state.collections[slug] ?? freshCollectionState();
  if (saved.done) {
    console.log("[" + slug + "] already marked done in state; skipping");
    return {
      pagesFetched: 0,
      itemsSeen: 0,
      productsIngested: 0,
      inserted: 0,
      updated: 0,
      sourcesAdded: 0,
      done: true,
      skippedAlreadyDone: true,
    };
  }

  const stats: CollectionRunStats = {
    pagesFetched: 0,
    itemsSeen: 0,
    productsIngested: 0,
    inserted: 0,
    updated: 0,
    sourcesAdded: 0,
    done: false,
    skippedAlreadyDone: false,
  };
  let nextToken = saved.nextToken;

  while (true) {
    if (options.maxPages > 0 && stats.pagesFetched >= options.maxPages) {
      console.log(
        "[" +
          slug +
          "] reached --max-pages " +
          options.maxPages +
          "; stopping this run (resumable)",
      );
      break;
    }

    const page = await fetchProductsPage(slug, nextToken);
    stats.pagesFetched += 1;
    stats.itemsSeen += page.data.length;

    if (options.dryRun) {
      await ingestInventoryPage({
        collectionSlug: slug,
        items: page.data,
        secret: input.secret,
        dryRun: true,
      });
      const firstTitle = page.data.length > 0 ? itemTitle(page.data[0]) : null;
      console.log(
        "[" +
          slug +
          "] page " +
          stats.pagesFetched +
          " -> " +
          page.data.length +
          " items fetched, first title: " +
          (firstTitle === null ? "(none)" : JSON.stringify(firstTitle)) +
          ", next=" +
          (page.next === null ? "no" : "yes"),
      );
      // Dry runs are observational: never persist crawl progress.
    } else {
      const ingest = await ingestInventoryPage({
        collectionSlug: slug,
        items: page.data,
        secret: input.secret,
        dryRun: false,
      });
      stats.productsIngested += ingest.productsIngested;
      stats.inserted += ingest.inserted;
      stats.updated += ingest.updated;
      stats.sourcesAdded += ingest.sourcesAdded;
      console.log(
        "[" +
          slug +
          "] page " +
          stats.pagesFetched +
          " -> +" +
          ingest.productsIngested +
          " ingested (skipped upc " +
          ingest.skippedNoUpc +
          "/noTitle " +
          ingest.skippedNoTitle +
          "), next=" +
          (page.next === null ? "no" : "yes"),
      );
      input.state.collections[slug] = {
        nextToken: page.next,
        done: page.next === null,
        pagesDone: saved.pagesDone + stats.pagesFetched,
        itemsSeen: saved.itemsSeen + stats.itemsSeen,
      };
      saveState(options.statePath, input.state);
    }

    if (page.next === null) {
      stats.done = true;
      break;
    }
    nextToken = page.next;
  }

  return stats;
}

function printSummary(
  perCollection: Map<string, CollectionRunStats>,
  elapsedMs: number,
  dryRun: boolean,
): void {
  const columns = [
    "collection",
    "pages",
    "items",
    "ingested",
    "inserted",
    "updated",
    "sources",
    "done",
  ] as const;
  const rows: string[][] = [];
  const totals = {
    pages: 0,
    items: 0,
    ingested: 0,
    inserted: 0,
    updated: 0,
    sources: 0,
  };
  for (const [slug, stats] of perCollection) {
    totals.pages += stats.pagesFetched;
    totals.items += stats.itemsSeen;
    totals.ingested += stats.productsIngested;
    totals.inserted += stats.inserted;
    totals.updated += stats.updated;
    totals.sources += stats.sourcesAdded;
    rows.push([
      stats.skippedAlreadyDone ? slug + " (done)" : slug,
      String(stats.pagesFetched),
      String(stats.itemsSeen),
      String(stats.productsIngested),
      String(stats.inserted),
      String(stats.updated),
      String(stats.sourcesAdded),
      stats.done ? "yes" : "no",
    ]);
  }
  rows.push([
    "TOTAL",
    String(totals.pages),
    String(totals.items),
    String(totals.ingested),
    String(totals.inserted),
    String(totals.updated),
    String(totals.sources),
    "",
  ]);

  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index].length)),
  );
  const renderRow = (row: string[]): string =>
    columns
      .map((column, index) => row[index].padEnd(widths[index]))
      .join("  ")
      .trimEnd();

  console.log("");
  console.log(renderRow([...columns]));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(renderRow(row));
  console.log("");
  console.log(
    "done in " +
      (elapsedMs / 1000).toFixed(1) +
      "s" +
      (dryRun ? " (dry-run; no Convex calls)" : ""),
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (
    argv.length === 0 ||
    argv.some((arg) => arg === "--help" || arg === "-h")
  ) {
    printUsage();
    return 0;
  }
  const { options, error } = parseCliArgs(argv);
  if (options === null) {
    console.error("error: " + (error ?? "invalid arguments"));
    printUsage();
    return 2;
  }

  // Prefer the real environment; fall back to the repo-root .env.local so the
  // driver works regardless of the caller's working directory.
  const envFileVars = parseEnvFile(resolvePath(repoRoot, ".env.local"));
  const secret = resolveSecret(envFileVars);
  if (options.dryRun) {
    if (secret.length === 0) {
      console.warn(
        "[secret] INVENTORY_CRAWL_SECRET is not set; dry-run proceeds without Convex",
      );
    }
  } else if (secret.length === 0) {
    console.error(
      "error: INVENTORY_CRAWL_SECRET is not set. Export it or add INVENTORY_CRAWL_SECRET=<secret> to .env.local in the repo root, then rerun. Use --dry-run to crawl without Convex.",
    );
    return 1;
  }

  let slugs = options.collections;
  if (slugs === null) {
    console.log("[sitemap] fetching collection list from shop-categories.xml");
    slugs = await fetchCollectionSlugs();
    if (slugs.length === 0) {
      console.error("error: no collection slugs found in the sitemap");
      return 1;
    }
    console.log("[sitemap] found " + slugs.length + " collections");
  }

  const state = loadState(options.statePath);
  const startedAt = Date.now();
  const perCollection = new Map<string, CollectionRunStats>();

  // Politeness: strictly sequential collections and pages, one request at a
  // time with at least 400ms between requests to pm.paymore.tech.
  for (const [index, slug] of slugs.entries()) {
    const stats = await crawlCollection({ slug, options, secret, state });
    perCollection.set(slug, stats);
    if (index < slugs.length - 1) await sleep(POLITE_DELAY_MS);
  }

  printSummary(perCollection, Date.now() - startedAt, options.dryRun);
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
      console.error(
        "fatal: " + (error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    });
}
