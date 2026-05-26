import { View, type ViewProps } from "react-native";

export type BarcodeScanningResult = {
  data: string;
  type: string;
  bounds?: unknown;
  cornerPoints?: unknown;
};

type CameraPermissionResponse = {
  granted: boolean;
  canAskAgain: boolean;
  status: "denied" | "granted" | "undetermined";
};

const deniedPermission: CameraPermissionResponse = {
  granted: false,
  canAskAgain: false,
  status: "denied",
};

export function CameraView(props: ViewProps) {
  return <View {...props} />;
}

export function useCameraPermissions(): [
  CameraPermissionResponse,
  () => Promise<CameraPermissionResponse>,
] {
  return [deniedPermission, async () => deniedPermission];
}
