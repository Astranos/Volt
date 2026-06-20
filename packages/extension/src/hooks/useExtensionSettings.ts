import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  structuredCloneSettings,
} from "@/src/domain/settings";
import type { CmdkSettings, SyncStorageResult } from "@/src/types/settings";

export function useExtensionSettings() {
  const [settings, setSettings] = useState<CmdkSettings>(() => mergeSettings());
  const [isSaved, setIsSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSavedFeedback = useCallback(() => {
    setIsSaved(true);

    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
    }

    savedTimerRef.current = setTimeout(() => {
      setIsSaved(false);
      savedTimerRef.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    chrome.storage.sync.get(["cmdkSettings"], (result: SyncStorageResult) => {
      setSettings(mergeSettings(result.cmdkSettings));
    });

    return () => {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const saveSettings = useCallback(
    (nextSettings: CmdkSettings) => {
      setSettings(nextSettings);

      return new Promise<void>((resolve) => {
        chrome.storage.sync.set({ cmdkSettings: nextSettings }, () => {
          showSavedFeedback();
          resolve();
        });
      });
    },
    [showSavedFeedback]
  );

  const resetSettings = useCallback(() => {
    return saveSettings(structuredCloneSettings(DEFAULT_SETTINGS));
  }, [saveSettings]);

  return {
    settings,
    setSettings,
    isSaved,
    saveSettings,
    resetSettings,
  };
}

export type SaveExtensionSettings = ReturnType<
  typeof useExtensionSettings
>["saveSettings"];
