export type ScannerIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type ScannerIceServerSource = "cloudflare" | "stun-fallback";

export type ScannerIceServersResponse = {
  iceServers: ScannerIceServer[];
  expiresAt: string;
  ttlSeconds: number;
  source: ScannerIceServerSource;
};

const ICE_URL_PREFIXES = ["stun:", "turn:", "turns:"] as const;

function isIceUrl(value: string) {
  return ICE_URL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function normalizeIceUrls(value: unknown): string | string[] | null {
  if (typeof value === "string") return value && isIceUrl(value) ? value : null;
  if (!Array.isArray(value)) return null;

  const urls = value.filter((url): url is string => typeof url === "string" && isIceUrl(url));
  return urls.length > 0 && urls.length === value.length ? urls : null;
}

function iceUrlsContainTurn(urls: string | string[]) {
  const list = Array.isArray(urls) ? urls : [urls];
  return list.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
}

export function normalizeScannerIceServer(value: unknown): ScannerIceServer | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as {
    urls?: unknown;
    username?: unknown;
    credential?: unknown;
  };
  const urls = normalizeIceUrls(raw.urls);
  if (!urls) return null;

  const username = typeof raw.username === "string" && raw.username ? raw.username : undefined;
  const credential = typeof raw.credential === "string" && raw.credential ? raw.credential : undefined;
  if (iceUrlsContainTurn(urls) && (!username || !credential)) return null;

  return {
    urls,
    ...(username ? { username } : {}),
    ...(credential ? { credential } : {}),
  };
}

export function normalizeScannerIceServers(value: unknown): ScannerIceServer[] | null {
  if (!Array.isArray(value)) return null;

  const iceServers = value.map(normalizeScannerIceServer);
  if (iceServers.some((server) => server === null)) return null;
  return iceServers as ScannerIceServer[];
}

export function buildScannerIceServersResponse({
  iceServers,
  nowMs,
  source,
  ttlSeconds,
}: {
  iceServers: ScannerIceServer[];
  nowMs?: number;
  source: ScannerIceServerSource;
  ttlSeconds: number;
}): ScannerIceServersResponse {
  const normalized = normalizeScannerIceServers(iceServers);
  if (!normalized || normalized.length === 0) {
    throw new Error("Invalid scanner ICE server list");
  }

  const safeTtlSeconds = Math.max(1, Math.floor(ttlSeconds));
  return {
    iceServers: normalized,
    expiresAt: new Date((nowMs ?? Date.now()) + safeTtlSeconds * 1000).toISOString(),
    ttlSeconds: safeTtlSeconds,
    source,
  };
}

export function scannerStunOnlyIceServersResponse({
  iceServers,
  nowMs,
  ttlSeconds,
}: {
  iceServers: ScannerIceServer[];
  nowMs?: number;
  ttlSeconds: number;
}) {
  return buildScannerIceServersResponse({
    iceServers,
    nowMs,
    source: "stun-fallback",
    ttlSeconds,
  });
}
