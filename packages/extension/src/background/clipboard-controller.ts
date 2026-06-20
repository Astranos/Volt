import type { RuntimeActionRegistry } from "./runtime-action-registry";
import type { LogFn } from "./runtime-action-registry";

type ClipboardControllerOptions = {
  chromeApi: typeof chrome;
  createOffscreenDocument: () => Promise<boolean>;
  log: LogFn;
};

export function createClipboardController({
  chromeApi,
  createOffscreenDocument,
  log,
}: ClipboardControllerOptions) {
  async function handleClipboardWithOffscreen(action: string, text?: string) {
    const offscreenCreated = await createOffscreenDocument();
    if (!offscreenCreated) {
      throw new Error("Failed to create offscreen document for clipboard access");
    }

    return chromeApi.runtime.sendMessage({
      action,
      text,
    });
  }

  function registerActions(registry: RuntimeActionRegistry) {
    registry.register("copyToClipboard", (message, _sender, sendResponse) => {
      const text = message.text;
      if (!text) {
        sendResponse({ success: false, error: "missing_text" });
        return true;
      }

      handleClipboardWithOffscreen("copyToClipboard", text)
        .then((response) => {
          sendResponse(response);
        })
        .catch((err) => {
          log("copyToClipboard offscreen error:", err);
          if (navigator.clipboard) {
            navigator.clipboard
              .writeText(text)
              .then(() => sendResponse({ success: true }))
              .catch((error) =>
                sendResponse({ success: false, error: String(error) })
              );
          } else {
            sendResponse({ success: false, error: String(err) });
          }
        });
      return true;
    });

    registry.register("readFromClipboard", (_message, _sender, sendResponse) => {
      handleClipboardWithOffscreen("readFromClipboard")
        .then((response) => {
          sendResponse(response);
        })
        .catch((err) => {
          log("readFromClipboard offscreen error:", err);
          if (navigator.clipboard) {
            navigator.clipboard
              .readText()
              .then((text) => sendResponse({ success: true, text }))
              .catch((error) =>
                sendResponse({ success: false, error: String(error) })
              );
          } else {
            sendResponse({ success: false, error: String(err) });
          }
        });
      return true;
    });
  }

  return {
    handleClipboardWithOffscreen,
    registerActions,
  };
}
