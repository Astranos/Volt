import { NativeEventEmitter, NativeModules, Platform, UIManager, requireNativeComponent } from "react-native";
import type { ViewStyle } from "react-native";

export type VoltClipTextCaptureResult = {
  text?: string;
  imageUri?: string;
  dataUrl?: string;
  size?: string;
  width?: string;
  height?: string;
};

type VoltClipTextRecognizerModule = {
  captureAndRecognize: () => Promise<VoltClipTextCaptureResult & { text: string }>;
  focusAt?: (x: number, y: number) => Promise<{ x: number; y: number }>;
  showPreview?: (x: number, y: number, width: number, height: number) => void;
  hidePreview?: () => void;
  setTorch?: (enabled: boolean) => Promise<{ enabled: boolean }>;
  setZoom?: (factor: number) => Promise<{ factor: number; min?: number; max: number }>;
  playSelectionHaptic?: () => void;
};

const nativeModule = NativeModules.VoltClipTextRecognizer as VoltClipTextRecognizerModule | undefined;
const eventEmitter = nativeModule ? new NativeEventEmitter(nativeModule as never) : null;
const nativeComponentName = "VoltClipTextCameraView";
const hasNativeTextCameraView =
  Platform.OS === "ios" && UIManager.getViewManagerConfig(nativeComponentName) != null;

export const hasVoltClipTextRecognizer = Platform.OS === "ios" && Boolean(nativeModule);

export const VoltClipTextCameraView = hasNativeTextCameraView
  ? requireNativeComponent<{
      onPreviewState?: (event: { nativeEvent?: { state?: "starting" | "ready" | "failed" } }) => void;
      style?: ViewStyle;
    }>(nativeComponentName)
  : null;

export function captureAndRecognizeVoltClipText() {
  if (!nativeModule) {
    return Promise.reject(new Error("Volt Clip text recognizer is unavailable."));
  }

  return nativeModule.captureAndRecognize();
}

export function addVoltClipTextCaptureListener(listener: (result: VoltClipTextCaptureResult) => void) {
  if (!eventEmitter) {
    return { remove() {} };
  }

  return eventEmitter.addListener("capture", (event: VoltClipTextCaptureResult & { phase?: string }) => {
    if (event.phase === "captured") listener(event);
  });
}

export function showVoltClipTextPreview(frame: { x: number; y: number; width: number; height: number }) {
  nativeModule?.showPreview?.(frame.x, frame.y, frame.width, frame.height);
}

export function hideVoltClipTextPreview() {
  nativeModule?.hidePreview?.();
}

export function focusVoltClipTextCamera(x: number, y: number) {
  return nativeModule?.focusAt?.(x, y) ?? Promise.resolve({ x, y });
}

export function setVoltClipTextCameraTorch(enabled: boolean) {
  return nativeModule?.setTorch?.(enabled) ?? Promise.resolve({ enabled: false });
}

export function setVoltClipTextCameraZoom(factor: number) {
  return nativeModule?.setZoom?.(factor) ?? Promise.resolve({ factor: 1, min: 1, max: 1 });
}

export function playVoltClipSelectionHaptic() {
  nativeModule?.playSelectionHaptic?.();
}
