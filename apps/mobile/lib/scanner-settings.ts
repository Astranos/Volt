import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useRef, useState } from "react";

const SETTINGS_STORAGE_KEY = "volt.mobileScanner.settings.v1";

export type ScannerSettings = {
  autoSendSingleBarcode: boolean;
  confirmMultipleBarcodes: boolean;
  dictationPunctuation: boolean;
  ocrInsertIntoCursor: boolean;
  scannerInsertIntoCursor: boolean;
};

export const defaultSettings: ScannerSettings = {
  autoSendSingleBarcode: true,
  confirmMultipleBarcodes: true,
  dictationPunctuation: true,
  ocrInsertIntoCursor: false,
  scannerInsertIntoCursor: true,
};

export function useScannerSettings() {
  const [settings, setSettings] = useState<ScannerSettings>(defaultSettings);
  const settingsRef = useRef(defaultSettings);

  const loadSettings = useCallback(async () => {
    try {
      const rawValue = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!rawValue) return;
      const parsed = JSON.parse(rawValue) as Partial<ScannerSettings>;
      const nextSettings = { ...defaultSettings, ...parsed };
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
    } catch {
      // Settings are non-critical; keep defaults if persisted data is unreadable.
    }
  }, []);

  const setSetting = useCallback(<Key extends keyof ScannerSettings>(key: Key, value: ScannerSettings[Key]) => {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      settingsRef.current = next;
      void AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { loadSettings, settings, settingsRef, setSetting };
}
