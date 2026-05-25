import { NativeModules, Platform } from "react-native";

type VoltClipClipboardModule = {
  getString: () => Promise<string>;
  getChangeCount: () => Promise<number>;
};

const nativeModule = NativeModules.VoltClipClipboard as VoltClipClipboardModule | undefined;

export const hasVoltClipClipboard = Platform.OS === "ios" && Boolean(nativeModule);

export function getVoltClipClipboardString() {
  if (!nativeModule) {
    return Promise.resolve("");
  }

  return nativeModule.getString();
}

export function getVoltClipClipboardChangeCount() {
  if (!nativeModule) {
    return Promise.resolve(0);
  }

  return nativeModule.getChangeCount();
}
