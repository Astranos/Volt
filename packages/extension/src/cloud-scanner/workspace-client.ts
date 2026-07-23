import type { WorkspaceId, WorkspaceResultPage } from "./workspace-types.ts";

export type WorkspaceTokenProvider = () => Promise<string | null>;

export type WorkspaceTransportRequest = {
  workspaceId: WorkspaceId;
  token: string;
  cursor?: string;
};

export type WorkspaceTransport = {
  listResults(request: WorkspaceTransportRequest): Promise<WorkspaceResultPage>;
  subscribeResults?: (
    request: WorkspaceTransportRequest & {
      onPage: (page: WorkspaceResultPage) => void;
      onError: (error: unknown) => void;
    },
  ) => WorkspaceSubscription;
};

export type WorkspaceSubscription = {
  stop(): void;
};

export function createWorkspaceClient(clientOptions: {
  getToken: WorkspaceTokenProvider;
  transport: WorkspaceTransport;
}) {

  async function listResults(workspaceId: WorkspaceId, cursor?: string) {
    const token = await clientOptions.getToken();
    if (!token) throw new Error("workspace_sign_in_required");
    const page = await clientOptions.transport.listResults({ workspaceId, token, cursor });
    if (page.workspaceId !== workspaceId) throw new Error("invalid_workspace_results");
    return page;
  }

  function subscribe(subscription: {
    workspaceId: WorkspaceId;
    cursor?: string;
    intervalMs?: number;
    onPage: (page: WorkspaceResultPage) => Promise<void> | void;
    onError?: (error: unknown) => void;
  }): WorkspaceSubscription {
    if (clientOptions.transport.subscribeResults) {
      let active: WorkspaceSubscription | null = null;
      let stopped = false;
      void clientOptions.getToken().then((token) => {
        if (stopped) return;
        if (!token) {
          subscription.onError?.(new Error("workspace_sign_in_required"));
          return;
        }
        active = clientOptions.transport.subscribeResults?.({
          workspaceId: subscription.workspaceId,
          token,
          cursor: subscription.cursor,
          onPage: (page) => {
            if (page.workspaceId === subscription.workspaceId) void subscription.onPage(page);
            else subscription.onError?.(new Error("invalid_workspace_results"));
          },
          onError: (error) => subscription.onError?.(error),
        }) ?? null;
      }).catch((error: unknown) => subscription.onError?.(error));
      return {
        stop() {
          stopped = true;
          active?.stop();
        },
      };
    }

    let stopped = false;
    let cursor = subscription.cursor;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const intervalMs = Math.max(1_000, subscription.intervalMs ?? 5_000);

    const poll = async () => {
      try {
        const page = await listResults(subscription.workspaceId, cursor);
        if (stopped) return;
        cursor = page.cursor ?? cursor;
        await subscription.onPage(page);
      } catch (error) {
        if (!stopped) subscription.onError?.(error);
      } finally {
        if (!stopped) timer = setTimeout(poll, intervalMs);
      }
    };
    void poll();
    return {
      stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
    };
  }

  return { listResults, subscribe };
}
