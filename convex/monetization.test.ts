import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { accountPolicy, workspaceLifecycleEnabled } from "./monetization";

beforeEach(() => {
  vi.stubEnv("WORKSPACE_STORAGE_POLICY_ENABLED", "");
  vi.stubEnv("WORKSPACE_FREE_RECORD_LIMIT", "");
  vi.stubEnv("WORKSPACE_FREE_BYTE_LIMIT", "");
});
afterEach(() => vi.unstubAllEnvs());

test("every account has seven-day history and the free storage limits", () => {
  expect(accountPolicy().workspace).toEqual({
    retentionDays: 7,
    recordsLimit: 1_000,
    bytesLimit: 104_857_600,
  });
  expect(workspaceLifecycleEnabled()).toBe(false);
  vi.stubEnv("WORKSPACE_STORAGE_POLICY_ENABLED", "TRUE");
  expect(workspaceLifecycleEnabled()).toBe(false);
  vi.stubEnv("WORKSPACE_STORAGE_POLICY_ENABLED", "true");
  expect(workspaceLifecycleEnabled()).toBe(true);
});

test("free storage limits accept environment overrides", () => {
  vi.stubEnv("WORKSPACE_FREE_RECORD_LIMIT", "250");
  vi.stubEnv("WORKSPACE_FREE_BYTE_LIMIT", "2097152");
  expect(accountPolicy().workspace).toEqual({
    retentionDays: 7,
    recordsLimit: 250,
    bytesLimit: 2_097_152,
  });
});

test.each(["-1", "0", "Infinity", "1000000000001", "1.5", "invalid"])(
  "invalid environment limit %s retains conservative defaults",
  (value) => {
    vi.stubEnv("WORKSPACE_FREE_RECORD_LIMIT", value);
    vi.stubEnv("WORKSPACE_FREE_BYTE_LIMIT", value);
    expect(accountPolicy().workspace).toMatchObject({
      recordsLimit: 1_000,
      bytesLimit: 104_857_600,
    });
  },
);
