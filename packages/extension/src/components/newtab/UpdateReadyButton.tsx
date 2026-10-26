import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { REOPEN_NEW_TAB_AFTER_UPDATE_KEY, UPDATE_AVAILABLE_VERSION_KEY } from "../../domain/extension-update";
import { compareVersions } from "./release-notes";

export async function restartVoltForUpdate() {
  let message = "Restarting Volt closes other Volt tabs, side panels, and popups. Unsaved handbook edits there will be lost. Restart now?";
  if (typeof chrome.runtime.getContexts === "function") {
    try {
      const [contexts, currentTab] = await Promise.all([
        chrome.runtime.getContexts({ contextTypes: ["TAB", "SIDE_PANEL", "POPUP"] }),
        chrome.tabs.getCurrent(),
      ]);
      if (currentTab?.id !== undefined) {
        const others = contexts.filter((context) => !(context.contextType === "TAB"
          && context.tabId === currentTab.id
          && (context.documentUrl === window.location.href || context.documentUrl === currentTab.url)));
        const tabs = others.filter((context) => context.contextType === "TAB").length;
        const panels = others.filter((context) => context.contextType === "SIDE_PANEL").length;
        const popups = others.filter((context) => context.contextType === "POPUP").length;
        const closing = [
          tabs ? `${tabs} other Volt ${tabs === 1 ? "tab" : "tabs"}` : "",
          panels ? panels === 1 ? "the Volt side panel" : `${panels} Volt side panels` : "",
          popups ? popups === 1 ? "a Volt popup" : `${popups} Volt popups` : "",
        ].filter(Boolean);
        message = closing.length ? `Restarting Volt closes ${closing.join(" and ")}. Unsaved handbook edits there will be lost. Restart now?` : "";
      }
    } catch {
      // If the open pages can't be checked, keep the generic confirmation.
    }
  }
  if (message && !window.confirm(message)) return;
  await chrome.storage.local.set({ [REOPEN_NEW_TAB_AFTER_UPDATE_KEY]: true });
  chrome.runtime.reload();
}

/** Shown once Chrome has downloaded a newer Volt that's waiting for a restart. */
export function UpdateReadyButton() {
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => {
    const running = chrome.runtime.getManifest().version;
    const apply = (value: unknown) => setReady(typeof value === "string" && compareVersions(value, running) > 0 ? value : null);
    void chrome.storage.local.get(UPDATE_AVAILABLE_VERSION_KEY).then((stored) => apply(stored[UPDATE_AVAILABLE_VERSION_KEY]));
    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === "local" && UPDATE_AVAILABLE_VERSION_KEY in changes) apply(changes[UPDATE_AVAILABLE_VERSION_KEY].newValue);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  if (!ready) return null;

  // Restarting closes extension pages, including this tab; the background reopens it.
  const restart = () => void restartVoltForUpdate();

  return <button
    aria-label={`Restart Volt to install version ${ready}`}
    className="newtab-settings-button newtab-update-button"
    data-tooltip={`Restart Volt to install ${ready}`}
    onClick={restart}
    type="button"
  >
    <RotateCw aria-hidden="true" />
    <span>Update ready</span>
  </button>;
}
