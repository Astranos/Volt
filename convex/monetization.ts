export const WORKSPACE_RETENTION_DAYS = 7;

export function workspaceLifecycleEnabled() {
  return process.env.WORKSPACE_STORAGE_POLICY_ENABLED === "true";
}

function limit(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000_000
    ? value
    : fallback;
}

export function accountPolicy() {
  return {
    workspace: {
      retentionDays: WORKSPACE_RETENTION_DAYS,
      recordsLimit: limit("WORKSPACE_FREE_RECORD_LIMIT", 1_000),
      bytesLimit: limit("WORKSPACE_FREE_BYTE_LIMIT", 104_857_600),
    },
  };
}
