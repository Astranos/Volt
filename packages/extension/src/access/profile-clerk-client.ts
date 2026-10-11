export type ProfileClerkClient = {
  session: { id: string } | null | undefined;
  user: { id: string } | null | undefined;
  client: { signIn: { create(args: { strategy: "ticket"; ticket: string }): Promise<{ status: string | null; createdSessionId: string | null }> } } | null | undefined;
  setActive(args: { session: string }): Promise<void>;
  signOut(): Promise<void>;
};

export const PROFILE_CLERK_OFFSCREEN_ACTION = "chromeProfileOffscreenClerk";

export type ProfileClerkOperation = "snapshot" | "createSignIn" | "setActive" | "signOut";

export async function createProfileClerkProxy(
  send: (message: unknown) => Promise<unknown>,
): Promise<ProfileClerkClient> {
  async function request(operation: ProfileClerkOperation, extra: Record<string, unknown> = {}) {
    const raw = await send({ action: PROFILE_CLERK_OFFSCREEN_ACTION, operation, ...extra });
    const response = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    if (response.success !== true || !response.value || typeof response.value !== "object") {
      throw new Error("Chrome profile authentication document did not respond.");
    }
    return response.value as Record<string, unknown>;
  }
  const snapshot = await request("snapshot");
  const client: ProfileClerkClient = {
    session: typeof snapshot.sessionId === "string" ? { id: snapshot.sessionId } : null,
    user: typeof snapshot.userId === "string" ? { id: snapshot.userId } : null,
    client: snapshot.hasClient === true ? { signIn: { create: async ({ ticket }) => {
      const result = await request("createSignIn", { ticket });
      return {
        status: typeof result.status === "string" ? result.status : null,
        createdSessionId: typeof result.createdSessionId === "string" ? result.createdSessionId : null,
      };
    } } } : null,
    async setActive({ session }) {
      const result = await request("setActive", { session });
      client.session = typeof result.sessionId === "string" ? { id: result.sessionId } : null;
      client.user = typeof result.userId === "string" ? { id: result.userId } : null;
    },
    async signOut() {
      await request("signOut");
      client.session = null;
      client.user = null;
    },
  };
  return client;
}
