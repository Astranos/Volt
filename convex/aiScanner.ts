export type AIScannerMode = "upc" | "name";

export type AIAnalysisResult = {
  mode: AIScannerMode;
  value: string | null;
  format: "upc_a" | "item-name";
  identifiedName?: string | null;
  platform?: string | null;
};

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
export const AI_SCANNER_MAX_IMAGE_BYTES = 1_500_000;
export const AI_SCANNER_TIMEOUT_MS = 45_000;

const UPC_PROMPT =
  'Identify the exact retail game release shown by this item, game case, or disc, including platform and edition when visible. The barcode does not need to be visible. Use web search to find a supported UPC candidate for that exact release. Return only JSON in the form {"name":"exact title or null","platform":"platform or null","upc":"12 digits or null"}. Never invent a code. Return a UPC only when search evidence supports the same title and platform. If an EAN-13 starts with 0, return its equivalent 12-digit UPC-A.';
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
  return normalized && normalized.length <= 80 ? normalized : null;
}

function promptForMode(mode: AIScannerMode): string {
  return mode === "upc" ? UPC_PROMPT : NAME_PROMPT;
}

export function parseAIResponse(mode: AIScannerMode, content: string): AIAnalysisResult {
  const withoutFence = content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence);
  } catch {
    throw new AIScannerError(502, "upstream-failed");
  }
  const payload = objectFrom(parsed);
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
    // GLM uses this same budget for hidden reasoning and the JSON answer. A
    // small cap can finish with `content: null` after spending every token on
    // reasoning, especially when UPC mode invokes web search.
    max_tokens: mode === "upc" ? 1_200 : 512,
    reasoning_effort: "low",
    include_reasoning: false,
    provider: { require_parameters: true },
  };
  if (mode === "upc") {
    request.tools = [{
      type: "openrouter:web_search",
      parameters: {
        engine: "exa",
        mode: "fast",
        max_results: 5,
        max_uses: 2,
        max_total_results: 8,
        max_characters: 2_000,
      },
    }];
    request.max_tool_calls = 2;
  }
  return JSON.stringify(request);
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
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !TITLE_NOISE_TOKENS.has(token));
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
  const normalizedUPC = normalizeUPCA(upc);
  if (!normalizedUPC || !identifiedName) return null;
  const searchURL = new URL("https://www.pricecharting.com/search-products");
  searchURL.searchParams.set("q", normalizedUPC);
  searchURL.searchParams.set("type", "prices");
  const response = await fetchImpl(searchURL, { method: "GET", redirect: "manual", signal });
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    if (response.ok) return null;
    throw new AIScannerError(response.status === 429 ? 429 : 502, response.status === 429 ? "upstream-rate-limited" : "upstream-failed");
  }
  const location = response.headers.get("location");
  if (!location) throw new AIScannerError(502, "upstream-failed");
  const destination = new URL(location, searchURL);
  if (destination.origin !== "https://www.pricecharting.com") return null;
  const parts = destination.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "game") return null;
  if (destination.searchParams.get("q")?.trim() !== normalizedUPC) return null;
  const [, consoleSlug, productSlug] = parts;
  if (!titleMatchesProductSlug(identifiedName, productSlug)) return null;
  const expectedPlatform = platform ? canonicalPlatform(platform) : null;
  const resolvedPlatform = canonicalPlatform(consoleSlug);
  if (expectedPlatform && resolvedPlatform && expectedPlatform !== resolvedPlatform) return null;
  return normalizedUPC;
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
  options: { apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AIAnalysisResult> {
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > AI_SCANNER_MAX_IMAGE_BYTES) {
    throw new AIScannerError(502, "upstream-failed");
  }
  const apiKey = (options.apiKey ?? process.env.OPENROUTER_API_KEY)?.trim();
  if (!apiKey) throw new AIScannerError(503, "not-configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? AI_SCANNER_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: buildOpenRouterRequest(mode, imageBytes),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 429) throw new AIScannerError(429, "upstream-rate-limited");
      throw new AIScannerError(502, "upstream-failed");
    }
    const responseBody: unknown = await response.json();
    const content = contentFromResponse(responseBody);
    if (!content) throw new AIScannerError(502, "upstream-failed");
    const analysis = parseAIResponse(mode, content);
    if (mode !== "upc" || !analysis.value) return analysis;
    return {
      ...analysis,
      value: await verifyPriceChartingUPC(
        analysis.value,
        analysis.identifiedName,
        analysis.platform,
        options.fetchImpl ?? fetch,
        controller.signal,
      ),
    };
  } catch (error) {
    if (error instanceof AIScannerError) throw error;
    if (controller.signal.aborted) throw new AIScannerError(504, "upstream-timeout");
    throw new AIScannerError(502, "upstream-failed");
  } finally {
    clearTimeout(timeout);
  }
}
