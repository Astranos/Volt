export const CLERK_CONVEX_TOKEN_STORAGE_KEY = "volt.clerk.convexToken.v1";
const TOKEN_MAX_AGE_MS = 50_000;

type StoredConvexToken = {
  token: string;
  storedAt: number;
};

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function publishClerkConvexToken(token: string | null) {
  if (!token) {
    await chrome.storage.session.remove(CLERK_CONVEX_TOKEN_STORAGE_KEY);
    return;
  }
  const payload: StoredConvexToken = { token, storedAt: Date.now() };
  await chrome.storage.session.set({ [CLERK_CONVEX_TOKEN_STORAGE_KEY]: payload });
}

export async function readPublishedClerkConvexToken(
  maxAgeMs = TOKEN_MAX_AGE_MS,
): Promise<string | null> {
  const stored = await chrome.storage.session.get(CLERK_CONVEX_TOKEN_STORAGE_KEY);
  const record = recordFrom(stored[CLERK_CONVEX_TOKEN_STORAGE_KEY]);
  if (!record || typeof record.token !== "string" || !record.token) return null;
  const storedAt = typeof record.storedAt === "number" ? record.storedAt : 0;
  if (!storedAt || Date.now() - storedAt > maxAgeMs) return null;
  return record.token;
}
