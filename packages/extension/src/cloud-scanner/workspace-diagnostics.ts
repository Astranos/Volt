export const WORKSPACE_DIAGNOSTICS_KEY = "volt.cloudScanner.diagnostics.v1";

const MAX_ENTRIES = 12;

export type WorkspaceDiagnosticStage =
  | "sidepanel-token"
  | "clerk-token"
  | "account-sync"
  | "subscriptions"
  | "registration";

export type WorkspaceDiagnostic = {
  at: number;
  stage: WorkspaceDiagnosticStage;
  status: "ok" | "signed-out" | "error";
  detail?: string;
};

function diagnosticFrom(value: unknown): WorkspaceDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== "number" || typeof record.stage !== "string") return null;
  if (record.status !== "ok" && record.status !== "signed-out" && record.status !== "error") {
    return null;
  }
  return {
    at: record.at,
    stage: record.stage as WorkspaceDiagnosticStage,
    status: record.status,
    detail: typeof record.detail === "string" ? record.detail : undefined,
  };
}

function entriesFrom(value: unknown): WorkspaceDiagnostic[] {
  return Array.isArray(value)
    ? value.map(diagnosticFrom).filter((entry): entry is WorkspaceDiagnostic => entry !== null)
    : [];
}

export async function recordWorkspaceDiagnostic(entry: Omit<WorkspaceDiagnostic, "at">) {
  try {
    const stored = await chrome.storage.local.get(WORKSPACE_DIAGNOSTICS_KEY);
    const current = entriesFrom(stored[WORKSPACE_DIAGNOSTICS_KEY]);
    const next: WorkspaceDiagnostic = { ...entry, at: Date.now() };
    const last = current[current.length - 1];
    // A 15s reconcile loop repeating one outcome must not push the interesting
    // history out of the buffer, so an unchanged repeat only refreshes its time.
    const merged =
      last && last.stage === next.stage && last.status === next.status && last.detail === next.detail
        ? [...current.slice(0, -1), next]
        : [...current, next].slice(-MAX_ENTRIES);
    await chrome.storage.local.set({ [WORKSPACE_DIAGNOSTICS_KEY]: merged });
  } catch {
    // Diagnostics must never break the path they observe.
  }
}

export async function readWorkspaceDiagnostics(): Promise<WorkspaceDiagnostic[]> {
  try {
    const stored = await chrome.storage.local.get(WORKSPACE_DIAGNOSTICS_KEY);
    return entriesFrom(stored[WORKSPACE_DIAGNOSTICS_KEY]);
  } catch {
    return [];
  }
}

function describe(entry: WorkspaceDiagnostic): string | null {
  const detail = entry.detail ? ` (${entry.detail})` : "";
  switch (entry.stage) {
    case "sidepanel-token":
      if (entry.status === "signed-out") return "Sign in to sync captures from your phone.";
      return entry.status === "error"
        ? `Chrome could not mint a Convex token for your account${detail}.`
        : null;
    case "clerk-token":
      if (entry.status === "signed-out") return "Sign in to sync captures from your phone.";
      if (entry.status !== "error") return null;
      return entry.detail === "offscreen_cookies_unavailable"
        ? "Background sync needs the sidepanel open — keep this panel open while your phone uploads."
        : `Chrome could not reach Clerk${detail}.`;
    case "account-sync":
      return entry.status === "error" ? `Workspace account sync failed${detail}.` : null;
    case "subscriptions":
      return entry.status === "error" ? `Workspace subscription failed${detail}.` : null;
    case "registration":
      return entry.status === "error" ? `Convex rejected this computer${detail}.` : null;
  }
}

// The newest failing stage wins: an old success must not mask a live failure,
// and a stage that recovered must not keep reporting its last error.
export function summarizeWorkspaceDiagnostics(
  entries: readonly WorkspaceDiagnostic[],
): string | null {
  const latest = [...entries].sort((a, b) => b.at - a.at);
  const newestPerStage = new Map<WorkspaceDiagnosticStage, WorkspaceDiagnostic>();
  for (const entry of latest) {
    if (!newestPerStage.has(entry.stage)) newestPerStage.set(entry.stage, entry);
  }
  const failing = [...newestPerStage.values()]
    .filter((entry) => entry.status !== "ok")
    .sort((a, b) => b.at - a.at);
  for (const entry of failing) {
    const message = describe(entry);
    if (message) return message;
  }
  return null;
}
