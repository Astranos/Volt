import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { REOPEN_NEW_TAB_AFTER_UPDATE_KEY, UPDATE_AVAILABLE_VERSION_KEY } from "../../domain/extension-update";
import { compareVersions } from "./release-notes";

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
  const restart = () => void chrome.storage.local.set({ [REOPEN_NEW_TAB_AFTER_UPDATE_KEY]: true }).then(() => chrome.runtime.reload());

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
