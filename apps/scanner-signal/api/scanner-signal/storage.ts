import type {
  ScannerJoinTokenRecord,
  ScannerPairingRecord,
} from "../../../../packages/scanner-protocol/src/index.ts";

export type JoinTokenRecord = ScannerJoinTokenRecord;
export type PairingRecord = ScannerPairingRecord;

const JOIN_TOKEN_KEY_PREFIX = "volt:scanner:join-token:";
const PAIRING_KEY_PREFIX = "volt:scanner:pairing:";

const globalState = globalThis as typeof globalThis & {
  __voltScannerJoinTokens?: Map<string, JoinTokenRecord>;
  __voltScannerPairings?: Map<string, PairingRecord>;
};

const memoryJoinTokens = (globalState.__voltScannerJoinTokens ??= new Map<string, JoinTokenRecord>());
const memoryPairings = (globalState.__voltScannerPairings ??= new Map<string, PairingRecord>());
const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const isVercelProduction = process.env.VERCEL === "1";

function hasRedisStorage() {
  return Boolean(redisUrl && redisToken);
}

export function ensureSignalStorage() {
  if (isVercelProduction && !hasRedisStorage()) {
    throw new Error("Persistent signal storage is not configured");
  }
}

async function redisCommand<T>(command: unknown[]) {
  if (!redisUrl || !redisToken) {
    throw new Error("Redis storage is not configured");
  }

  const result = await fetch(redisUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const payload = (await result.json()) as { result?: T; error?: string };
  if (!result.ok) {
    throw new Error(`Redis command failed with ${result.status}: ${payload.error ?? "unknown error"}`);
  }
  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result;
}

function joinTokenKey(token: string) {
  return `${JOIN_TOKEN_KEY_PREFIX}${token}`;
}

function pairingKey(pairingId: string) {
  return `${PAIRING_KEY_PREFIX}${pairingId}`;
}

function cleanupMemoryJoinTokens() {
  const now = Date.now();
  for (const [token, record] of memoryJoinTokens.entries()) {
    if (record.graceExpiresAt < now && record.attempts.every((attempt) => attempt.expiresAt < now)) {
      memoryJoinTokens.delete(token);
    }
  }
}

function cleanupMemoryPairings() {
  const now = Date.now();
  for (const [pairingId, record] of memoryPairings.entries()) {
    if (record.expiresAt < now) {
      memoryPairings.delete(pairingId);
    }
  }
}

async function getJoinToken(token: string) {
  if (hasRedisStorage()) {
    const rawToken = await redisCommand<string | null>(["GET", joinTokenKey(token)]);
    return rawToken ? (JSON.parse(rawToken) as JoinTokenRecord) : undefined;
  }

  cleanupMemoryJoinTokens();
  return memoryJoinTokens.get(token);
}

async function saveJoinToken(record: JoinTokenRecord) {
  const now = Date.now();
  const latestAttemptExpiry = Math.max(0, ...record.attempts.map((attempt) => attempt.expiresAt));
  const expiresAt = Math.max(record.graceExpiresAt, latestAttemptExpiry);
  const ttlSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));

  if (hasRedisStorage()) {
    await redisCommand<string>(["SET", joinTokenKey(record.token), JSON.stringify(record), "EX", ttlSeconds]);
    return;
  }

  cleanupMemoryJoinTokens();
  memoryJoinTokens.set(record.token, record);
}

async function getPairing(pairingId: string) {
  if (hasRedisStorage()) {
    const rawPairing = await redisCommand<string | null>(["GET", pairingKey(pairingId)]);
    return rawPairing ? (JSON.parse(rawPairing) as PairingRecord) : undefined;
  }

  cleanupMemoryPairings();
  return memoryPairings.get(pairingId);
}

async function savePairing(record: PairingRecord) {
  const now = Date.now();
  const requestExpiry = Math.max(0, ...record.reconnectRequests.map((request) => request.expiresAt));
  const expiresAt = Math.max(record.expiresAt, requestExpiry);
  const ttlSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));

  if (hasRedisStorage()) {
    await redisCommand<string>(["SET", pairingKey(record.id), JSON.stringify(record), "EX", ttlSeconds]);
    return;
  }

  cleanupMemoryPairings();
  memoryPairings.set(record.id, record);
}

async function getPairingsForBrowserSession(browserSessionId: string) {
  if (hasRedisStorage()) {
    const keys = await redisCommand<string[]>(["KEYS", `${PAIRING_KEY_PREFIX}*`]);
    const records: PairingRecord[] = [];
    for (const key of keys ?? []) {
      const rawPairing = await redisCommand<string | null>(["GET", key]);
      if (!rawPairing) continue;
      const pairing = JSON.parse(rawPairing) as PairingRecord;
      if (pairing.browserSessionId === browserSessionId) {
        records.push(pairing);
      }
    }
    return records;
  }

  cleanupMemoryPairings();
  return [...memoryPairings.values()].filter((pairing) => pairing.browserSessionId === browserSessionId);
}

export const signalStorage = {
  getJoinToken,
  saveJoinToken,
  getPairing,
  savePairing,
  getPairingsForBrowserSession,
};
