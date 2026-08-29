export type AIScannerMode = "upc" | "name";

export type AIAnalysisResult = {
  mode: AIScannerMode;
  value: string | null;
  format: "upc_a" | "item-name";
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
export const AI_SCANNER_TIMEOUT_MS = 20_000;

const UPC_PROMPT =
  'Identify a single consumer retail UPC-A from the pictured item, game case, or disc. Return only JSON in the form {"upc":"12 digits or null"}. Never invent a code; return null when it is unreadable or uncertain. If an EAN-13 starts with 0, return its equivalent 12-digit UPC-A.';
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
    return { mode, value: typeof raw === "string" ? normalizeUPCA(raw) : null, format: "upc_a" };
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
  return JSON.stringify({
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
    max_tokens: 128,
    reasoning_effort: "low",
    include_reasoning: false,
    provider: { require_parameters: true },
  });
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
    return parseAIResponse(mode, content);
  } catch (error) {
    if (error instanceof AIScannerError) throw error;
    if (controller.signal.aborted) throw new AIScannerError(504, "upstream-timeout");
    throw new AIScannerError(502, "upstream-failed");
  } finally {
    clearTimeout(timeout);
  }
}
