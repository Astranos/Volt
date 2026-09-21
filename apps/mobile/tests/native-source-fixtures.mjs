import { existsSync, readFileSync } from "node:fs";

import { readClipViewSources } from "./clip-view-sources.mjs";

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function swiftStringArrayLiteral(values) {
  return `\\[${values.map((value) => `"${escapeRegExp(value)}"`).join(", ")}\\]`;
}

export function swiftRawValueList(values) {
  return values.map((value) => `MessageType\\.${value}.rawValue`).join(",\\s*");
}

export const appSwiftSource = readFileSync(
  new URL("../ios/Volt/App/VoltApp.swift", import.meta.url),
  "utf8"
);
export const scannerStoreSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerStore.swift", import.meta.url),
  "utf8"
);
export const captureModeSwiftSource = readFileSync(
  new URL("../ios/Volt/Models/CaptureMode.swift", import.meta.url),
  "utf8"
);
export const cloudAPIContractsSwiftSource = readFileSync(
  new URL("../ios/Volt/Models/CloudAPIContracts.swift", import.meta.url),
  "utf8"
);
export const cloudWorkspaceStoreSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/CloudWorkspaceStore.swift", import.meta.url),
  "utf8"
);
export const mobileCloudAPIClientSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/MobileCloudAPIClient.swift", import.meta.url),
  "utf8"
);
export const scannerStoreCaptureActionsSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerStoreCaptureActions.swift", import.meta.url),
  "utf8"
);
export const cameraModelSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/CameraModel.swift", import.meta.url),
  "utf8"
);
export const captureOrientationSwiftSource = readFileSync(
  new URL("../ios/Volt/Models/CaptureOrientation.swift", import.meta.url),
  "utf8"
);
export const cameraZoomControllerSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/CameraZoomController.swift", import.meta.url),
  "utf8"
);
export const cameraDeviceSelectorSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/CameraDeviceSelector.swift", import.meta.url),
  "utf8"
);
export const scannerSignalingSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerSignalingClient.swift", import.meta.url),
  "utf8"
);
export const scannerProtocolSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/ScannerProtocol.swift", import.meta.url),
  "utf8"
);
export const pairingURLParserSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/PairingURLParser.swift", import.meta.url),
  "utf8"
);
export const scannerRecognitionModelsSwiftSource = readFileSync(
  new URL("../ios/Volt/Models/ScannerRecognitionModels.swift", import.meta.url),
  "utf8"
);
export const rootViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/RootView.swift", import.meta.url),
  "utf8"
);
export const voltBrandSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/VoltBrand.swift", import.meta.url),
  "utf8"
);
export const cloudTargetPickerSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CloudTargetPickerSheet.swift", import.meta.url),
  "utf8"
);
export const settingsViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SettingsView.swift", import.meta.url),
  "utf8"
);
export const scannerViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/ScannerView.swift", import.meta.url),
  "utf8"
);
export const captureModeCardsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CaptureModeCards.swift", import.meta.url),
  "utf8"
);
export const capturedResultRowSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CapturedResultRow.swift", import.meta.url),
  "utf8"
);
export const scannerCameraLayerSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/ScannerCameraLayer.swift", import.meta.url),
  "utf8"
);
export const captureSessionViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CaptureSessionView.swift", import.meta.url),
  "utf8"
);
export const subscriptionActionsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SubscriptionActionsView.swift", import.meta.url),
  "utf8"
);
export const cameraSessionControlsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CameraSessionControls.swift", import.meta.url),
  "utf8"
);
export const sharedCameraSessionControlsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SharedCameraSessionControls.swift", import.meta.url),
  "utf8"
);
export const sharedScannerTabComponentsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SharedScannerTabComponents.swift", import.meta.url),
  "utf8"
);
export const sharedPairingSessionComponentsSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SharedPairingSessionComponents.swift", import.meta.url),
  "utf8"
);
export const sharedCaptureSessionOverlaysSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/SharedCaptureSessionOverlays.swift", import.meta.url),
  "utf8"
);
export const cameraPreviewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/CameraPreview.swift", import.meta.url),
  "utf8"
);
export const ocrReviewLayerSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/OcrReviewLayer.swift", import.meta.url),
  "utf8"
);
export const textRecognizerSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/TextRecognizer.swift", import.meta.url),
  "utf8"
);
export const ocrTextCleanerSwiftSource = readFileSync(
  new URL("../ios/Volt/Services/OcrTextCleaner.swift", import.meta.url),
  "utf8"
);
export const uploadViewSwiftSource = readFileSync(
  new URL("../ios/Volt/Views/ResultsView.swift", import.meta.url),
  "utf8"
);
export const clipViewsSwiftSource = readClipViewSources();
export const clipBarcodeScannerServiceSwiftSource = readFileSync(
  new URL("../ios/VoltClip/Services/ClipBarcodeScannerService.swift", import.meta.url),
  "utf8"
);
export const clipScannerStoreSwiftSource = readFileSync(
  new URL("../ios/VoltClip/Services/ClipScannerStore.swift", import.meta.url),
  "utf8"
);
export const clipGuestCloudClientSwiftSource = readFileSync(
  new URL("../ios/VoltClip/Services/AppClipGuestCloudClient.swift", import.meta.url),
  "utf8"
);
export const clipOCRServiceSwiftSource = readFileSync(
  new URL("../ios/VoltClip/Services/ClipOCRService.swift", import.meta.url),
  "utf8"
);
export const xcodeProjectSource = readFileSync(
  new URL("../ios/Volt.xcodeproj/project.pbxproj", import.meta.url),
  "utf8"
);
export const infoPlistSource = readFileSync(
  new URL("../ios/Volt/Info.plist", import.meta.url),
  "utf8"
);
export const clipInfoPlistSource = readFileSync(
  new URL("../ios/VoltClip/Info.plist", import.meta.url),
  "utf8"
);
export const podfileSource = readFileSync(
  new URL("../ios/Podfile", import.meta.url),
  "utf8"
);

export const removedFullAppSources = [
  "ScannerWebRTCConnection.swift",
  "ScannerStorePairedSessions.swift",
  "DictationModel.swift",
  "PairingSessionsView.swift",
];
