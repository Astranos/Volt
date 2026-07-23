export const USAGE_RECONNECT_WINDOW_MS = 30 * 60 * 1000;
export const USAGE_SESSION_MAX_MS = 8 * 60 * 60 * 1000;

export type StoredUsageSession = {
  usageSessionId: string;
  createdAt: number;
  startedAt?: number;
  disconnectedAt?: number;
  maxEndsAt?: number;
};

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseStoredUsageSession(
  value: unknown,
): StoredUsageSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.usageSessionId !== "string" ||
    record.usageSessionId.length === 0 ||
    !validTimestamp(record.createdAt)
  ) {
    return null;
  }
  return {
    usageSessionId: record.usageSessionId,
    createdAt: record.createdAt,
    startedAt: validTimestamp(record.startedAt)
      ? record.startedAt
      : undefined,
    disconnectedAt: validTimestamp(record.disconnectedAt)
      ? record.disconnectedAt
      : undefined,
    maxEndsAt: validTimestamp(record.maxEndsAt)
      ? record.maxEndsAt
      : undefined,
  };
}

export function canReuseUsageSession(
  session: StoredUsageSession | null,
  now = Date.now(),
) {
  if (!session) return false;
  const hardEnd =
    session.maxEndsAt ??
    (session.startedAt ?? session.createdAt) + USAGE_SESSION_MAX_MS;
  if (now >= hardEnd) return false;
  if (
    session.disconnectedAt &&
    now - session.disconnectedAt >= USAGE_RECONNECT_WINDOW_MS
  ) {
    return false;
  }
  return true;
}

export function getOrCreateUsageSession(
  session: StoredUsageSession | null,
  createId: () => string,
  now = Date.now(),
): StoredUsageSession {
  if (canReuseUsageSession(session, now) && session) return session;
  return { usageSessionId: createId(), createdAt: now };
}

export function connectedUsageSession(
  session: StoredUsageSession,
  serverTiming: { startedAt?: number; maxEndsAt?: number },
  now = Date.now(),
): StoredUsageSession {
  const startedAt = serverTiming.startedAt ?? session.startedAt ?? now;
  return {
    ...session,
    startedAt,
    maxEndsAt:
      serverTiming.maxEndsAt ??
      session.maxEndsAt ??
      startedAt + USAGE_SESSION_MAX_MS,
    disconnectedAt: undefined,
  };
}
