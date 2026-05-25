import { NativeEventEmitter, NativeModules, Platform } from "react-native";

export type VoltClipBarcodeCandidate = {
  value: string;
  format: string;
};

type VoltClipBarcodeScannerModule = {
  start: () => Promise<{ running: boolean }>;
  stop: () => Promise<{ running: boolean }>;
};

const nativeModule = NativeModules.VoltClipBarcodeScanner as VoltClipBarcodeScannerModule | undefined;
const eventEmitter = nativeModule ? new NativeEventEmitter(nativeModule as never) : null;

export const hasVoltClipBarcodeScanner = Platform.OS === "ios" && Boolean(nativeModule && eventEmitter);

export function startVoltClipBarcodeScanner() {
  if (!nativeModule) {
    return Promise.reject(new Error("Volt Clip barcode scanner is unavailable."));
  }

  return nativeModule.start();
}

export function stopVoltClipBarcodeScanner() {
  if (!nativeModule) {
    return Promise.resolve({ running: false });
  }

  return nativeModule.stop();
}

export function addVoltClipBarcodeCandidateListener(listener: (candidate: VoltClipBarcodeCandidate) => void) {
  if (!eventEmitter) {
    return { remove() {} };
  }

  return eventEmitter.addListener("candidate", (candidate: VoltClipBarcodeCandidate) => {
    if (typeof candidate.value === "string" && typeof candidate.format === "string") {
      listener(candidate);
    }
  });
}

export function addVoltClipBarcodeErrorListener(listener: (message: string) => void) {
  if (!eventEmitter) {
    return { remove() {} };
  }

  return eventEmitter.addListener("error", (event: { message?: string }) => {
    listener(typeof event.message === "string" && event.message ? event.message : "Barcode scanner failed.");
  });
}
