export type AIScannerMode = "upc" | "name";

export type AIAnalysisResult = {
  mode: AIScannerMode;
  value: string | null;
  format: "upc_a" | "item-name";
  identifiedName?: string | null;
  platform?: string | null;
};

export type ProductIdentity = {
  name: string;
  platform: string | null;
  edition: string | null;
  region: string | null;
  brand: string | null;
  model: string | null;
  mpn: string | null;
  color: string | null;
  storage: string | null;
  carrier: string | null;
};

export type AIScannerCatalogMatch = {
  upc: string;
  title: string;
  platform: string | null;
  edition: string | null;
  brand: string | null;
  model: string | null;
  mpn: string | null;
  color: string | null;
  storage: string | null;
  carrier: string | null;
};

export type PriceChartingVerificationOutcome =
  | "verified"
  | "invalid-candidate"
  | "identity-missing"
  | "no-product-redirect"
  | "foreign-redirect"
  | "query-mismatch"
  | "title-mismatch"
  | "platform-mismatch";

export type AIScannerTraceEvent =
  | ({ stage: "identity"; outcome: "resolved"; elapsedMs: number } & ProductIdentity)
  | { stage: "identity"; outcome: "unresolved"; elapsedMs: number }
  | { stage: "catalog"; outcome: "candidate"; source: "product-catalog" | "web-search"; upc: string; elapsedMs: number }
  | { stage: "catalog"; outcome: "no-candidate"; source: "product-catalog" | "web-search"; elapsedMs: number }
  | { stage: "verification"; outcome: PriceChartingVerificationOutcome; upc: string | null; destination: string | null; elapsedMs: number };

export class AIScannerError extends Error {
  constructor(
    readonly status: 429 | 502 | 503 | 504,
    readonly code: "not-configured" | "upstream-failed" | "upstream-rate-limited" | "upstream-timeout",
  ) {
    super(code);
    this.name = "AIScannerError";
  }
}

export const AI_SCANNER_MODEL = "z-ai/glm-5.3-flash";
export const AI_SCANNER_PROVIDER = "z-ai/fp8";
export const AI_SCANNER_MAX_IMAGE_BYTES = 1_500_000;
export const AI_SCANNER_TIMEOUT_MS = 45_000;

const UPC_IDENTITY_PROMPT =
  'Identify the exact retail product shown by this item, packaging, game case, or disc. The barcode does not need to be visible. Read the marketed product name and every visible distinguishing detail that can identify its catalog variant. Return only JSON in the form {"name":"product title or null","brand":"brand or null","model":"model or null","mpn":"manufacturer part number or null","color":"color or null","storage":"storage capacity or null","carrier":"carrier or null","platform":"game platform or null","edition":"edition or null","region":"region or null"}. Do not search for or guess a barcode or any detail that is not visible. Return a null name when the product cannot be identified confidently.';
const NAME_PROMPT =
  'Identify the exact product title or name shown by this item, game disc, or game case. Return only JSON in the form {"name":"title or null"}. Do not describe condition or add explanation. Return null when the item cannot be identified confidently.';

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isValidEAN13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < value.length - 1; index += 1) {
    sum += Number(value[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return (sum + Number(value[12])) % 10 === 0;
}

export function isValidUPCA(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < value.length - 1; index += 1) {
    sum += Number(value[index]) * (index % 2 === 0 ? 3 : 1);
  }
  return (sum + Number(value[11])) % 10 === 0;
}

export function normalizeUPCA(value: string): string | null {
  const compact = value.trim().replace(/[\s-]/g, "");
  if (/^\d{12}$/.test(compact) && isValidUPCA(compact)) return compact;
  if (/^0\d{12}$/.test(compact) && isValidEAN13(compact)) {
    const upc = compact.slice(1);
    return isValidUPCA(upc) ? upc : null;
  }
  return null;
}

const GENERIC_NAME_VALUES = new Set([
  "unknown",
  "unidentified",
  "not sure",
  "not found",
  "no match",
  "no confident match",
  "cannot identify",
  "could not identify",
  "unable to identify",
  "not identifiable",
  "n/a",
  "none",
  "null",
]);

export function normalizeItemName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 200) return null;
  if (GENERIC_NAME_VALUES.has(normalized.toLowerCase())) return null;
  return normalized;
}

function normalizePlatform(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 80 || GENERIC_NAME_VALUES.has(normalized.toLowerCase())) return null;
  return normalized;
}

function normalizeIdentityDetail(value: unknown, maxLength = 100): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maxLength || GENERIC_NAME_VALUES.has(normalized.toLowerCase())) return null;
  return normalized;
}

function promptForMode(mode: AIScannerMode): string {
  return mode === "upc" ? UPC_IDENTITY_PROMPT : NAME_PROMPT;
}

function parseProductIdentity(content: string): ProductIdentity | null {
  const parsed = parseJSONResponse(content);
  const name = typeof parsed.name === "string" ? normalizeItemName(parsed.name) : null;
  if (!name) return null;
  return {
    name,
    platform: normalizePlatform(parsed.platform),
    edition: normalizeIdentityDetail(parsed.edition),
    region: normalizeIdentityDetail(parsed.region),
    brand: normalizeIdentityDetail(parsed.brand, 80),
    model: normalizeIdentityDetail(parsed.model, 120),
    mpn: normalizeIdentityDetail(parsed.mpn, 80),
    color: normalizeIdentityDetail(parsed.color, 80),
    storage: normalizeIdentityDetail(parsed.storage, 40),
    carrier: normalizeIdentityDetail(parsed.carrier, 80),
  };
}

function parseJSONResponse(content: string): Record<string, unknown> {
  const withoutFence = content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  const jsonObject = firstJSONObject(withoutFence);
  try {
    return objectFrom(JSON.parse(jsonObject ?? withoutFence) as unknown);
  } catch {
    throw new AIScannerError(502, "upstream-failed");
  }
}

export function parseCatalogUPCResponse(content: string): string | null {
  try {
    const payload = parseJSONResponse(content);
    if (typeof payload.upc === "string") {
      const upc = normalizeUPCA(payload.upc);
      if (upc) return upc;
    }
  } catch {
    // Web-search providers occasionally wrap an otherwise valid code in malformed prose.
  }
  const candidates = Array.from(content.matchAll(/(?<!\d)\d{12,13}(?!\d)/g), (match) => normalizeUPCA(match[0]))
    .filter((upc): upc is string => upc !== null);
  const uniqueCandidates = [...new Set(candidates)];
  return uniqueCandidates.length === 1 ? uniqueCandidates[0] : null;
}

function firstJSONObject(content: string): string | null {
  const start = content.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let isInString = false;
  let isEscaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (isInString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        isInString = false;
      }
      continue;
    }
    if (character === '"') {
      isInString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return null;
}

export function parseAIResponse(mode: AIScannerMode, content: string): AIAnalysisResult {
  const payload = parseJSONResponse(content);
  if (mode === "upc") {
    const raw = payload.upc;
    return {
      mode,
      value: typeof raw === "string" ? normalizeUPCA(raw) : null,
      format: "upc_a",
      identifiedName: typeof payload.name === "string" ? normalizeItemName(payload.name) : null,
      platform: normalizePlatform(payload.platform),
    };
  }
  const raw = payload.name;
  return { mode, value: typeof raw === "string" ? normalizeItemName(raw) : null, format: "item-name" };
}

function base64FromBytes(bytes: ArrayBuffer): string {
  const values = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < values.length; offset += chunkSize) {
    binary += String.fromCharCode(...values.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function buildOpenRouterRequest(mode: AIScannerMode, imageBytes: ArrayBuffer): string {
  const request: Record<string, unknown> = {
    model: AI_SCANNER_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: promptForMode(mode) },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64FromBytes(imageBytes)}` } },
      ],
    }],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 512,
    reasoning_effort: "low",
    include_reasoning: false,
    provider: { only: [AI_SCANNER_PROVIDER], require_parameters: true },
  };
  return JSON.stringify(request);
}

export function buildOpenRouterCatalogRequest(identity: ProductIdentity): string {
  const knownDetails = [
    `Title: ${identity.name}`,
    identity.platform ? `Platform: ${identity.platform}` : null,
    identity.edition ? `Edition: ${identity.edition}` : null,
    identity.region ? `Region: ${identity.region}` : null,
    identity.brand ? `Brand: ${identity.brand}` : null,
    identity.model ? `Model: ${identity.model}` : null,
    identity.mpn ? `MPN: ${identity.mpn}` : null,
    identity.color ? `Color: ${identity.color}` : null,
    identity.storage ? `Storage: ${identity.storage}` : null,
    identity.carrier ? `Carrier: ${identity.carrier}` : null,
  ].filter((value): value is string => value !== null).join("\n");
  return JSON.stringify({
    model: AI_SCANNER_MODEL,
    messages: [{
      role: "user",
      content: `Find the supported retail UPC-A for this exact product variant using web search.\n${knownDetails}\nReturn only JSON in the form {"upc":"12 digits or null"}. Never invent a code. Match every supplied distinguishing detail exactly. If an EAN-13 starts with 0, return its equivalent 12-digit UPC-A. Return null when search evidence is missing or conflicting.`,
    }],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 800,
    reasoning_effort: "low",
    include_reasoning: false,
    provider: { only: [AI_SCANNER_PROVIDER], require_parameters: true },
    tools: [{
      type: "openrouter:web_search",
      parameters: {
        engine: "exa",
        mode: "fast",
        max_results: 5,
        max_uses: 2,
        max_total_results: 8,
        max_characters: 2_000,
      },
    }],
    max_tool_calls: 2,
  });
}

const PLATFORM_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["ps5", ["playstation5", "ps5"]],
  ["ps4", ["playstation4", "ps4"]],
  ["ps3", ["playstation3", "ps3"]],
  ["ps2", ["playstation2", "ps2"]],
  ["ps1", ["playstation1", "playstation", "ps1", "psx"]],
  ["xboxseries", ["xboxseriesx", "xboxseriess", "xboxseries"]],
  ["xboxone", ["xboxone"]],
  ["xbox360", ["xbox360"]],
  ["switch2", ["nintendoswitch2", "switch2"]],
  ["switch", ["nintendoswitch", "switch"]],
  ["wiiu", ["nintendowiiu", "wiiu"]],
  ["wii", ["nintendowii", "wii"]],
  ["gamecube", ["nintendogamecube", "gamecube"]],
  ["n64", ["nintendo64", "n64"]],
  ["snes", ["supernintendo", "snes"]],
  ["nes", ["nintendoentertainmentsystem", "nes"]],
  ["3ds", ["nintendo3ds", "3ds"]],
  ["ds", ["nintendods", "ds"]],
  ["dreamcast", ["segadreamcast", "dreamcast"]],
  ["saturn", ["segasaturn", "saturn"]],
  ["genesis", ["segagenesis", "megadrive", "genesis"]],
];

function compactCatalogText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function canonicalPlatform(value: string): string | null {
  const compact = compactCatalogText(value);
  return PLATFORM_ALIASES.find(([, aliases]) => aliases.some((alias) => compact.includes(alias)))?.[0] ?? null;
}

const TITLE_NOISE_TOKENS = new Set(["a", "an", "the", "edition", "game", "video"]);

function catalogTitleTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !TITLE_NOISE_TOKENS.has(token));
}

export function catalogIdentityMatchScore(
  identity: ProductIdentity,
  candidate: Omit<AIScannerCatalogMatch, "upc">,
): number | null {
  const expectedTitle = catalogTitleTokens(identity.name);
  const candidateTitle = catalogTitleTokens(candidate.title);
  if (expectedTitle.length === 0 || candidateTitle.length === 0) return null;

  if (identity.platform) {
    const expectedPlatform = canonicalPlatform(identity.platform);
    const candidatePlatform = canonicalPlatform([candidate.platform, candidate.title].filter(Boolean).join(" "));
    if (expectedPlatform && candidatePlatform) {
      if (expectedPlatform !== candidatePlatform) return null;
    } else if (candidate.platform) {
      const expectedPlatformText = compactCatalogText(identity.platform);
      const candidatePlatformText = compactCatalogText(candidate.platform);
      if (
        expectedPlatformText !== candidatePlatformText
        && !expectedPlatformText.includes(candidatePlatformText)
        && !candidatePlatformText.includes(expectedPlatformText)
      ) return null;
    }
  }

  const expectedSet = new Set(expectedTitle);
  const candidateSet = new Set(candidateTitle);
  const matchingTokens = [...expectedSet].filter((token) => candidateSet.has(token)).length;
  const expectedCoverage = matchingTokens / expectedSet.size;
  const candidateCoverage = matchingTokens / candidateSet.size;
  const exactTitle = compactCatalogText(identity.name) === compactCatalogText(candidate.title);
  if (!exactTitle && expectedCoverage < 0.8) return null;

  const details: ReadonlyArray<readonly [string | null, string | null, number]> = [
    [identity.edition, candidate.edition, 8],
    [identity.brand, candidate.brand, 10],
    [identity.model, candidate.model, 18],
    [identity.mpn, candidate.mpn, 40],
    [identity.color, candidate.color, 8],
    [identity.storage, candidate.storage, 12],
    [identity.carrier, candidate.carrier, 10],
  ];
  let detailScore = 0;
  for (const [expected, actual, weight] of details) {
    if (!expected) continue;
    const expectedText = compactCatalogText(expected);
    const actualText = compactCatalogText(actual ?? candidate.title);
    if (!expectedText || !actualText) continue;
    if (!actualText.includes(expectedText) && !expectedText.includes(actualText)) return null;
    detailScore += weight;
  }

  return (exactTitle ? 100 : 0)
    + expectedCoverage * 20
    + candidateCoverage * 5
    + (identity.platform && candidate.platform ? 8 : 0)
    + detailScore;
}

function titleMatchesProductSlug(name: string, productSlug: string): boolean {
  const expected = catalogTitleTokens(name);
  const actual = new Set(catalogTitleTokens(productSlug));
  if (expected.length === 0) return false;
  const numericTokens = expected.filter((token) => /^\d+$/.test(token));
  if (numericTokens.some((token) => !actual.has(token))) return false;
  const matching = expected.filter((token) => actual.has(token)).length;
  return matching >= Math.min(2, expected.length) && matching / expected.length >= 0.65;
}

export async function verifyPriceChartingUPC(
  upc: string,
  identifiedName: string | null | undefined,
  platform: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await verifyPriceChartingUPCDetails(upc, identifiedName, platform, fetchImpl, signal);
  return result.outcome === "verified" ? result.upc : null;
}

export async function verifyPriceChartingUPCDetails(
  upc: string,
  identifiedName: string | null | undefined,
  platform: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ outcome: PriceChartingVerificationOutcome; upc: string | null; destination: string | null }> {
  const normalizedUPC = normalizeUPCA(upc);
  if (!normalizedUPC) return { outcome: "invalid-candidate", upc: null, destination: null };
  if (!identifiedName) return { outcome: "identity-missing", upc: normalizedUPC, destination: null };
  const searchURL = new URL("https://www.pricecharting.com/search-products");
  searchURL.searchParams.set("q", normalizedUPC);
  searchURL.searchParams.set("type", "prices");
  const response = await fetchImpl(searchURL, { method: "GET", redirect: "manual", signal });
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    if (response.ok) return { outcome: "no-product-redirect", upc: normalizedUPC, destination: response.url || null };
    throw new AIScannerError(response.status === 429 ? 429 : 502, response.status === 429 ? "upstream-rate-limited" : "upstream-failed");
  }
  const location = response.headers.get("location");
  if (!location) throw new AIScannerError(502, "upstream-failed");
  const destination = new URL(location, searchURL);
  const destinationURL = destination.toString();
  if (destination.origin !== "https://www.pricecharting.com") {
    return { outcome: "foreign-redirect", upc: normalizedUPC, destination: destinationURL };
  }
  const parts = destination.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "game") {
    return { outcome: "no-product-redirect", upc: normalizedUPC, destination: destinationURL };
  }
  if (destination.searchParams.get("q")?.trim() !== normalizedUPC) {
    return { outcome: "query-mismatch", upc: normalizedUPC, destination: destinationURL };
  }
  const [, consoleSlug, productSlug] = parts;
  if (!titleMatchesProductSlug(identifiedName, productSlug)) {
    return { outcome: "title-mismatch", upc: normalizedUPC, destination: destinationURL };
  }
  const expectedPlatform = platform ? canonicalPlatform(platform) : null;
  const resolvedPlatform = canonicalPlatform(consoleSlug);
  if (expectedPlatform && resolvedPlatform && expectedPlatform !== resolvedPlatform) {
    return { outcome: "platform-mismatch", upc: normalizedUPC, destination: destinationURL };
  }
  return { outcome: "verified", upc: normalizedUPC, destination: destinationURL };
}

function contentFromResponse(value: unknown): string | null {
  const choices = objectFrom(value).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = objectFrom(objectFrom(choices[0]).message);
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => objectFrom(part).text)
    .filter((part): part is string => typeof part === "string")
    .join("");
  return text || null;
}

export async function requestOpenRouterAnalysis(
  mode: AIScannerMode,
  imageBytes: ArrayBuffer,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    catalogLookup?: (identity: ProductIdentity) => Promise<AIScannerCatalogMatch | null>;
    onTrace?: (event: AIScannerTraceEvent) => void;
  } = {},
): Promise<AIAnalysisResult> {
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > AI_SCANNER_MAX_IMAGE_BYTES) {
    throw new AIScannerError(502, "upstream-failed");
  }
  const apiKey = (options.apiKey ?? process.env.OPENROUTER_API_KEY)?.trim();
  if (!apiKey) throw new AIScannerError(503, "not-configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? AI_SCANNER_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const identityStartedAt = Date.now();
    const identityContent = await requestOpenRouterContent(
      buildOpenRouterRequest(mode, imageBytes), apiKey, fetchImpl, controller.signal,
    );
    if (mode === "name") return parseAIResponse(mode, identityContent);
    const identity = parseProductIdentity(identityContent);
    if (!identity) {
      options.onTrace?.({ stage: "identity", outcome: "unresolved", elapsedMs: Date.now() - identityStartedAt });
      return { mode, value: null, format: "upc_a", identifiedName: null, platform: null };
    }
    options.onTrace?.({ stage: "identity", outcome: "resolved", ...identity, elapsedMs: Date.now() - identityStartedAt });

    if (options.catalogLookup) {
      const productCatalogStartedAt = Date.now();
      try {
        const match = await options.catalogLookup(identity);
        const catalogUPC = match && catalogIdentityMatchScore(identity, match) !== null
          ? normalizeUPCA(match.upc)
          : null;
        if (match && catalogUPC) {
          options.onTrace?.({
            stage: "catalog",
            outcome: "candidate",
            source: "product-catalog",
            upc: catalogUPC,
            elapsedMs: Date.now() - productCatalogStartedAt,
          });
          return {
            mode,
            value: catalogUPC,
            format: "upc_a",
            identifiedName: match.title,
            platform: match.platform,
          };
        }
        options.onTrace?.({
          stage: "catalog",
          outcome: "no-candidate",
          source: "product-catalog",
          elapsedMs: Date.now() - productCatalogStartedAt,
        });
      } catch {
        options.onTrace?.({
          stage: "catalog",
          outcome: "no-candidate",
          source: "product-catalog",
          elapsedMs: Date.now() - productCatalogStartedAt,
        });
      }
    }

    const catalogStartedAt = Date.now();
    const catalogContent = await requestOpenRouterContent(
      buildOpenRouterCatalogRequest(identity), apiKey, fetchImpl, controller.signal,
    );
    const candidate = parseCatalogUPCResponse(catalogContent);
    if (!candidate) {
      options.onTrace?.({ stage: "catalog", outcome: "no-candidate", source: "web-search", elapsedMs: Date.now() - catalogStartedAt });
      return { mode, value: null, format: "upc_a", identifiedName: identity.name, platform: identity.platform };
    }
    options.onTrace?.({ stage: "catalog", outcome: "candidate", source: "web-search", upc: candidate, elapsedMs: Date.now() - catalogStartedAt });

    const verificationStartedAt = Date.now();
    const verification = await verifyPriceChartingUPCDetails(
      candidate,
      identity.name,
      identity.platform,
      fetchImpl,
      controller.signal,
    );
    options.onTrace?.({ stage: "verification", ...verification, elapsedMs: Date.now() - verificationStartedAt });
    return {
      mode,
      value: verification.outcome === "verified" ? verification.upc : null,
      format: "upc_a",
      identifiedName: identity.name,
      platform: identity.platform,
    };
  } catch (error) {
    if (error instanceof AIScannerError) throw error;
    if (controller.signal.aborted) throw new AIScannerError(504, "upstream-timeout");
    throw new AIScannerError(502, "upstream-failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function requestOpenRouterContent(
  body: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body,
    signal,
  });
  if (!response.ok) {
    if (response.status === 429) throw new AIScannerError(429, "upstream-rate-limited");
    throw new AIScannerError(502, "upstream-failed");
  }
  const responseBody: unknown = await response.json();
  const content = contentFromResponse(responseBody);
  if (!content) throw new AIScannerError(502, "upstream-failed");
  return content;
}
