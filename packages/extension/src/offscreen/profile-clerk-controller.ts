import { PROFILE_CLERK_OFFSCREEN_ACTION, type ProfileClerkClient } from "../access/profile-clerk-client";

// Keep the SDK in the DOM-capable document. WXT inlines dynamic imports in
// worker bundles, including Clerk's module-level stylesheet DOM access.
export function createProfileClerkOffscreenController({
  extensionId,
  createClient,
}: {
  extensionId: string;
  createClient: () => Promise<ProfileClerkClient>;
}) {
  let activeClient: ProfileClerkClient | null = null;
  function snapshot(clerk: ProfileClerkClient) {
    return { sessionId: clerk.session?.id ?? null, userId: clerk.user?.id ?? null, hasClient: Boolean(clerk.client) };
  }
  async function operate(message: Record<string, unknown>) {
    if (message.operation === "snapshot" || !activeClient) activeClient = await createClient();
    const clerk = activeClient;
    switch (message.operation) {
      case "snapshot": return snapshot(clerk);
      case "createSignIn": {
        if (!clerk.client || typeof message.ticket !== "string" || !message.ticket) throw new Error("invalid_profile_sign_in");
        const result = await clerk.client.signIn.create({ strategy: "ticket", ticket: message.ticket });
        return { status: result.status, createdSessionId: result.createdSessionId };
      }
      case "setActive":
        if (typeof message.session !== "string" || !message.session) throw new Error("invalid_profile_session");
        await clerk.setActive({ session: message.session });
        return snapshot(clerk);
      case "signOut":
        await clerk.signOut();
        activeClient = null;
        return {};
      default: throw new Error("invalid_profile_operation");
    }
  }
  return {
    handleMessage(raw: unknown, sender: { id?: string; tab?: unknown; url?: string }, respond: (value: unknown) => void) {
      if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).action !== PROFILE_CLERK_OFFSCREEN_ACTION) return false;
      // Only the background worker may redeem tickets or mutate sessions.
      if (sender.id !== extensionId || sender.tab || (sender.url && sender.url !== `chrome-extension://${extensionId}/background.js`)) {
        respond({ success: false, error: "unauthorized_extension_sender" });
        return true;
      }
      void operate(raw as Record<string, unknown>)
        .then(value => respond({ success: true, value }))
        .catch(() => respond({ success: false, error: "profile_auth_failed" }));
      return true;
    },
  };
}
