import type {
  LiveTargetSelection,
  WorkspaceId,
  WorkspaceReplica,
  WorkspaceResultPage,
} from "./workspace-types.ts";
import { mergeWorkspaceReplica } from "./workspace-results.ts";

export type KeyValueStorage = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};

const REPLICA_PREFIX = "volt.cloudScanner.replica.v1";
const LIVE_TARGET_PREFIX = "volt.cloudScanner.liveTarget.v1";

function replicaKey(workspaceId: WorkspaceId) {
  return `${REPLICA_PREFIX}.${workspaceId}`;
}

function targetKey(workspaceId: WorkspaceId) {
  return `${LIVE_TARGET_PREFIX}.${workspaceId}`;
}

function storedReplica(value: unknown, workspaceId: WorkspaceId): WorkspaceReplica | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<WorkspaceReplica>;
  return candidate.workspaceId === workspaceId && Array.isArray(candidate.batches)
    ? (candidate as WorkspaceReplica)
    : null;
}

export function createWorkspaceStore(storage: KeyValueStorage) {
  return {
    async getReplica(workspaceId: WorkspaceId) {
      return storedReplica(await storage.get(replicaKey(workspaceId)), workspaceId);
    },

    async mergePage(page: WorkspaceResultPage) {
      const current = await this.getReplica(page.workspaceId);
      const merged = mergeWorkspaceReplica(current, page);
      await storage.set(replicaKey(page.workspaceId), merged);
      return merged;
    },

    async getLiveTarget(workspaceId: WorkspaceId): Promise<LiveTargetSelection> {
      const value = await storage.get(targetKey(workspaceId));
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const candidate = value as Partial<LiveTargetSelection>;
        if (
          candidate.workspaceId === workspaceId &&
          (typeof candidate.selectedComputerId === "string" || candidate.selectedComputerId === null)
        ) return candidate as LiveTargetSelection;
      }
      return { workspaceId, selectedComputerId: null };
    },

    async setLiveTarget(selection: LiveTargetSelection) {
      await storage.set(targetKey(selection.workspaceId), selection);
    },
  };
}

export function chromeLocalKeyValueStorage(chromeApi: typeof chrome): KeyValueStorage {
  return {
    async get(key) {
      const values = await chromeApi.storage.local.get(key);
      return values[key];
    },
    async set(key, value) {
      await chromeApi.storage.local.set({ [key]: value });
    },
  };
}
