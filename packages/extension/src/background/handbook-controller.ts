import { isTrustedExtensionPageSender, type ExtensionMessageSender } from "../access/sender-policy.ts";

// Extension pages that show handbook results in a Command Menu. The sidepanel
// and handbook page talk to Convex directly.
const COMMAND_MENU_PAGES = ["/newtab.html"];
const CONVEX_ID = /^[0-9a-z]{16,64}$/;

type HandbookMessage = { action?: unknown; id?: unknown };

function offscreenValue(response: unknown): unknown {
  if (!response || typeof response !== "object") throw new Error("Handbook did not respond.");
  const envelope = response as { success?: unknown; value?: unknown; error?: unknown };
  if (envelope.success !== true) throw new Error(typeof envelope.error === "string" ? envelope.error : "Handbook did not respond.");
  return envelope.value;
}

/** Relays Command Menu handbook reads to the offscreen document's signed-in Convex client. */
export function createHandbookController({
  extensionId,
  sendOffscreenMessage,
}: {
  extensionId: string;
  sendOffscreenMessage: (message: unknown) => Promise<unknown>;
}) {
  async function forward(action: string, extra: Record<string, unknown> = {}) {
    return offscreenValue(await sendOffscreenMessage({ action, ...extra }));
  }

  function handleMessage(rawMessage: unknown, sender: ExtensionMessageSender, sendResponse: (response?: unknown) => void) {
    if (!rawMessage || typeof rawMessage !== "object") return false;
    const message = rawMessage as HandbookMessage;
    if (message.action !== "handbookList" && message.action !== "handbookRevealSecret") return false;
    if (!isTrustedExtensionPageSender(sender, extensionId, COMMAND_MENU_PAGES)) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return true;
    }
    const operation = async () => {
      if (message.action === "handbookList") {
        const value = await forward("handbookOffscreenList");
        if (!Array.isArray(value)) throw new Error("Handbook returned an invalid list.");
        return value;
      }
      if (typeof message.id !== "string" || !CONVEX_ID.test(message.id)) throw new Error("Invalid handbook entry.");
      return forward("handbookOffscreenRevealSecret", { id: message.id });
    };
    void operation().then((value) => sendResponse({ success: true, value }))
      .catch((error: unknown) => sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return { handleMessage };
}
