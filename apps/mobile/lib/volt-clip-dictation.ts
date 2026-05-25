import { NativeEventEmitter, NativeModules, Platform } from "react-native";

export type VoltClipDictationPermissions = {
  granted: boolean;
  speechStatus: string;
  microphoneGranted: boolean;
};

type VoltClipDictationModule = {
  currentPermissions: () => Promise<VoltClipDictationPermissions>;
  requestPermissions: () => Promise<VoltClipDictationPermissions>;
  start: (options?: { addsPunctuation?: boolean }) => Promise<{ running: boolean }>;
  stop: () => Promise<{ running: boolean }>;
};

const nativeModule = NativeModules.VoltClipDictation as VoltClipDictationModule | undefined;
const eventEmitter = nativeModule ? new NativeEventEmitter(nativeModule as never) : null;

export const hasVoltClipDictation = Platform.OS === "ios" && Boolean(nativeModule && eventEmitter);

export function getVoltClipDictationPermissions() {
  if (!nativeModule) {
    return Promise.resolve({ granted: false, speechStatus: "unavailable", microphoneGranted: false });
  }

  return nativeModule.currentPermissions();
}

export function requestVoltClipDictationPermissions() {
  if (!nativeModule) {
    return Promise.resolve({ granted: false, speechStatus: "unavailable", microphoneGranted: false });
  }

  return nativeModule.requestPermissions();
}

export function startVoltClipDictation(options?: { addsPunctuation?: boolean }) {
  if (!nativeModule) {
    return Promise.reject(new Error("Volt Clip dictation is unavailable."));
  }

  return nativeModule.start(options);
}

export function stopVoltClipDictation() {
  if (!nativeModule) {
    return Promise.resolve({ running: false });
  }

  return nativeModule.stop();
}

export function addVoltClipDictationPartialListener(listener: (transcript: string) => void) {
  if (!eventEmitter) {
    return { remove() {} };
  }

  return eventEmitter.addListener("partial", (event: { transcript?: string }) => {
    if (typeof event.transcript === "string") listener(event.transcript);
  });
}

export function addVoltClipDictationFinalListener(listener: (transcript: string) => void) {
  if (!eventEmitter) {
    return { remove() {} };
  }

  return eventEmitter.addListener("final", (event: { transcript?: string }) => {
    if (typeof event.transcript === "string") listener(event.transcript);
  });
}

export function addVoltClipDictationErrorListener(listener: (message: string) => void) {
  if (!eventEmitter) {
    return { remove() {} };
  }

  return eventEmitter.addListener("error", (event: { message?: string }) => {
    listener(typeof event.message === "string" && event.message ? event.message : "Dictation failed.");
  });
}
