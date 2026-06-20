const SIGNAL_PREFIX = /^\/api\/signal\/?/;

export type SignalRequestBody = Record<string, unknown>;

export type NormalizedPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};

export function makeSecretId(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function signalPartsFromRequest(request: Request) {
  const url = new URL(request.url);
  return url.pathname.replace(SIGNAL_PREFIX, "").split("/").filter(Boolean).map(decodeURIComponent);
}

export async function signalBodyFromRequest(request: Request): Promise<SignalRequestBody> {
  if (request.method === "GET" || request.method === "OPTIONS") return {};
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as SignalRequestBody) : {};
  } catch (_error) {
    return {};
  }
}

export function stringFrom(value: unknown, maxLength = 4000) {
  return typeof value === "string" && value ? value.slice(0, maxLength) : undefined;
}

export function stringArrayFrom(value: unknown, maxItems = 20, maxLength = 80) {
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .map((item) => item.slice(0, maxLength))
    .slice(0, maxItems);
  return strings.length ? strings : undefined;
}

export function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function browserClaimFrom(request: Request, body: SignalRequestBody) {
  return request.headers.get("X-Volt-Browser-Claim") ?? stringFrom(body.browserClaim, 240);
}

export function pairingSecretFrom(request: Request, body: SignalRequestBody) {
  return request.headers.get("X-Volt-Pairing-Secret") ?? stringFrom(body.pairingSecret, 240);
}

export function normalizePushSubscription(value: unknown): NormalizedPushSubscription | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: { auth?: unknown; p256dh?: unknown };
  };
  if (typeof raw.endpoint !== "string" || !raw.endpoint) return undefined;
  if (!raw.keys || typeof raw.keys.auth !== "string" || typeof raw.keys.p256dh !== "string") return undefined;
  return {
    endpoint: raw.endpoint,
    ...(typeof raw.expirationTime === "number" || raw.expirationTime === null ? { expirationTime: raw.expirationTime } : {}),
    keys: {
      auth: raw.keys.auth,
      p256dh: raw.keys.p256dh,
    },
  };
}
