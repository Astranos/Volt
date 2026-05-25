import { NativeModules, Platform, requireNativeComponent } from "react-native";
import type { ViewStyle } from "react-native";

type VoltClipTextRecognizerModule = {
  captureAndRecognize: () => Promise<{ text: string; imageUri?: string }>;
  showPreview?: (x: number, y: number, width: number, height: number) => void;
  hidePreview?: () => void;
};

const nativeModule = NativeModules.VoltClipTextRecognizer as VoltClipTextRecognizerModule | undefined;

export const hasVoltClipTextRecognizer = Platform.OS === "ios" && Boolean(nativeModule);

export const VoltClipTextCameraView =
  Platform.OS === "ios"
    ? requireNativeComponent<{
        onPreviewState?: (event: { nativeEvent?: { state?: "starting" | "ready" | "failed" } }) => void;
        style?: ViewStyle;
      }>("VoltClipTextCameraView")
    : null;

export function captureAndRecognizeVoltClipText() {
  if (!nativeModule) {
    return Promise.reject(new Error("Volt Clip text recognizer is unavailable."));
  }

  return nativeModule.captureAndRecognize();
}

export function showVoltClipTextPreview(frame: { x: number; y: number; width: number; height: number }) {
  nativeModule?.showPreview?.(frame.x, frame.y, frame.width, frame.height);
}

export function hideVoltClipTextPreview() {
  nativeModule?.hidePreview?.();
}
