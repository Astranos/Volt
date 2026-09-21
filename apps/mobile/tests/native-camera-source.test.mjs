import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { scannerProtocolGolden } from "@volt/scanner-protocol/protocol-fixtures";
import {
  scannerStoreSwiftSource,
  scannerStoreCaptureActionsSwiftSource,
  cameraModelSwiftSource,
  captureOrientationSwiftSource,
  cameraZoomControllerSwiftSource,
  cameraDeviceSelectorSwiftSource,
  rootViewSwiftSource,
  cloudTargetPickerSwiftSource,
  settingsViewSwiftSource,
  scannerViewSwiftSource,
  captureModeCardsSwiftSource,
  scannerCameraLayerSwiftSource,
  captureSessionViewSwiftSource,
  sharedCameraSessionControlsSwiftSource,
  sharedPairingSessionComponentsSwiftSource,
  cameraPreviewSwiftSource,
  uploadViewSwiftSource,
  clipViewsSwiftSource,
  clipBarcodeScannerServiceSwiftSource,
  clipInfoPlistSource,
} from "./native-source-fixtures.mjs";

test("native capture session remains available without a WebRTC connection", () => {
  assert.match(scannerViewSwiftSource, /CaptureSessionView\(isPresented: \$isCaptureSessionPresented, mode: \.ocr\)/);
  assert.match(scannerViewSwiftSource, /UnifiedCaptureLaunchCard\(action: startCapture\)/);
  assert.doesNotMatch(scannerViewSwiftSource, /guard store\.connectionStatus\.isConnected/);
  assert.match(captureSessionViewSwiftSource, /isCaptureEnabled: !store\.isDictationBusy/);
  assert.doesNotMatch(captureSessionViewSwiftSource, /\.onChange\(of: store\.connectionStatus\)/);
  assert.doesNotMatch(captureSessionViewSwiftSource, /isConnectionRecoveryPresented|handleConnectionStatusChange/);
  assert.doesNotMatch(scannerStoreSwiftSource, /func recoverMostRecentPairedSession\(\) -> Bool/);
});

test("unified camera starts from the hero card and history groups mixed captures", () => {
  // The bottom accessory duplicated the hero launch card, so the tab keeps only the card.
  assert.doesNotMatch(scannerViewSwiftSource, /ScannerBottomActionAccessory/);
  assert.doesNotMatch(scannerViewSwiftSource, /safeAreaInset/);
  assert.doesNotMatch(scannerViewSwiftSource, /bottomAccessoryContentPadding/);
  // Both roots use the same floating controls.
  assert.match(clipViewsSwiftSource, /ScannerHomeControls/);

  // A saved-item count is replaced by the captures themselves.
  assert.doesNotMatch(captureModeCardsSwiftSource, /CaptureModeActivityCard/);
  assert.match(captureModeCardsSwiftSource, /struct CaptureModeCapturesSection: View/);
  assert.match(captureModeCardsSwiftSource, /Text\("Recent \\\(mode\.activityNoun\)"\)/);
  assert.match(captureModeCardsSwiftSource, /Array\(results\.prefix\(mode == \.photo \? 9 : 5\)\)/);
  assert.match(captureModeCardsSwiftSource, /mode == \.photo \{\s*photoGrid/);
  assert.match(captureModeCardsSwiftSource, /LazyVGrid\(columns: photoColumns/);
  assert.match(captureModeCardsSwiftSource, /CapturedResultRow\(\s*result: result,\s*canResend: true/);
  // Truncation is disclosed rather than silent.
  assert.match(captureModeCardsSwiftSource, /Text\("\\\(hiddenCount\) more saved"\)/);
  assert.doesNotMatch(captureModeCardsSwiftSource, /more in Sessions/);

  assert.match(scannerViewSwiftSource, /ComputerAvailabilityCard[\s\S]*captureHistory/);
  assert.match(scannerViewSwiftSource, /captureHistorySessions\(from: store\.results\)/);
  assert.match(scannerViewSwiftSource, /Dictionary\(grouping: results\) \{ result in/);
  assert.match(scannerViewSwiftSource, /result\.batchId \?\? result\.id\.uuidString\.lowercased\(\)/);
  assert.match(scannerViewSwiftSource, /Continue session/);
  assert.match(scannerViewSwiftSource, /Button\("Continue session"[\s\S]*\.tint\(VoltBrand\.green\)/);
  assert.match(scannerViewSwiftSource, /CaptureHistorySessionCard\(/);
  assert.match(sharedCameraSessionControlsSwiftSource, /if showsModePicker \{\s*modePicker\s*\}[\s\S]*connectionSlot[\s\S]*finishSlot[\s\S]*shutterButton/);
  assert.match(sharedCameraSessionControlsSwiftSource, /\.scrollTargetLayout\(\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /\.scrollTargetBehavior\(\.viewAligned\(limitBehavior: \.never, anchor: \.center\)\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /\.scrollPosition\(id: \$centeredModeID, anchor: \.center\)/);
  const modePickerStart = sharedCameraSessionControlsSwiftSource.indexOf("private var modePicker: some View");
  const modePickerEnd = sharedCameraSessionControlsSwiftSource.indexOf("private var cameraToolsRow", modePickerStart);
  const modePickerSource = sharedCameraSessionControlsSwiftSource.slice(modePickerStart, modePickerEnd);
  assert.doesNotMatch(modePickerSource, /\.background\([^\n]*Capsule|Capsule\(\)\.stroke/);
  assert.match(captureSessionViewSwiftSource, /isModeSelectionEnabled: !store\.isDictating && !store\.isDictationBusy/);
  assert.match(uploadViewSwiftSource, /struct PhotoLibraryUploadSection: View/);
  assert.match(uploadViewSwiftSource, /Text\("From Photo Library"\)/);
  assert.match(uploadViewSwiftSource, /ScannerPhotoPickerAccessory\(/);
  assert.doesNotMatch(uploadViewSwiftSource, /Recent Uploads/);
  assert.doesNotMatch(rootViewSwiftSource, /Label\("Upload", systemImage: "square\.and\.arrow\.up"\)|case upload/);
  assert.match(scannerViewSwiftSource, /onResend: \{ result in[\s\S]*insertResultIntoComputer\(id: result\.id\)/);
  assert.match(scannerViewSwiftSource, /onDelete: \{ result in[\s\S]*removeResult\(id: result\.id\)/);
});

test("native capture session exposes the optional cloud cursor target", () => {
  assert.match(scannerViewSwiftSource, /CloudTargetButton/);
  assert.match(scannerViewSwiftSource, /CloudTargetPickerSheet/);
  assert.match(cloudTargetPickerSwiftSource, /"This iPhone"/);
  assert.match(cloudTargetPickerSwiftSource, /availableComputers/);
  assert.doesNotMatch(captureSessionViewSwiftSource, /CloudTargetButton/);
  assert.match(captureSessionViewSwiftSource, /connectionLabel: "Write"[\s\S]*onConnection: \{\s*isTargetPickerPresented = true/);
  assert.match(captureSessionViewSwiftSource, /\.sheet\(isPresented: \$isTargetPickerPresented\) \{\s*CloudTargetPickerSheet\(\)/);
  assert.match(captureSessionViewSwiftSource, /\.sheet\(isPresented: \$isSubscriptionPaywallPresented\)[\s\S]*SubscriptionPaywallView\(showsDismissAction: true\)/);
  assert.doesNotMatch(captureSessionViewSwiftSource, /\.sheet\(isPresented: \$isSubscriptionPaywallPresented\)[\s\S]*NavigationStack/);
  assert.match(cloudTargetPickerSwiftSource, /var isCompact = false[\s\S]*frame\(minHeight: isCompact \? 36 : 48\)[\s\S]*controlSize\(isCompact \? \.small : \.regular\)/);
  assert.match(cloudTargetPickerSwiftSource, /frame\(minHeight: isCompact \? 36 : 48\)/);
  // Computer availability now streams continuously over a live Convex subscription
  // (CloudWorkspaceStore.startComputersSubscriptionIfNeeded), so the view no longer
  // needs to trigger a manual refresh on appear.
});

test("native library uploads cannot become the next camera capture batch", () => {
  const uploadStart = scannerStoreCaptureActionsSwiftSource.indexOf(
    "func uploadPhotos(_ images: [UIImage]) async"
  );
  const uploadEnd = scannerStoreCaptureActionsSwiftSource.indexOf(
    "func capturePhoto() async",
    uploadStart
  );
  const uploadSource = scannerStoreCaptureActionsSwiftSource.slice(uploadStart, uploadEnd);

  assert.ok(uploadStart >= 0 && uploadEnd > uploadStart);
  assert.doesNotMatch(uploadSource, /capturePhotoBatch\s*=/);
  assert.match(
    scannerStoreCaptureActionsSwiftSource,
    /func currentPhotoBatch\(now: Date\) -> String \{[\s\S]*if let activeCaptureBatchId[\s\S]*if let capturePhotoBatch,[\s\S]*capturePhotoBatch = \(batch, now\.addingTimeInterval\(5 \* 60\)\)/
  );
  assert.match(scannerViewSwiftSource, /result\.batchId \?\? result\.id\.uuidString\.lowercased\(\)/);
});

test("native photo viewfinder sits below the fixed top status area", () => {
  assert.match(scannerCameraLayerSwiftSource, /private let photoTopStatusClearance: CGFloat = 86/);
  assert.doesNotMatch(scannerCameraLayerSwiftSource, /photoControlsReservedHeight/);
  assert.match(
    scannerCameraLayerSwiftSource,
    /private func photoPreviewLayout\(in proxy: GeometryProxy\) -> \(side: CGFloat, topOffset: CGFloat\) \{\s*let availableHeight = max\(0, proxy\.size\.height - photoTopStatusClearance\)/
  );
  assert.doesNotMatch(scannerCameraLayerSwiftSource, /proxy\.safeAreaInsets/);
  // Photo mode alone respects the safe area; text and barcode keep their full-bleed preview.
  assert.match(
    captureSessionViewSwiftSource,
    /ScannerCameraLayer\(gridVisible: gridVisible && !store\.isProductScannerActive\)\s*\.ignoresSafeArea\(edges: store\.activeMode == \.photo \? \[\] : \.all\)/
  );
  assert.match(captureSessionViewSwiftSource, /\.background\(Color\.black\.ignoresSafeArea\(\)\)/);
  assert.match(scannerCameraLayerSwiftSource, /cameraPreview\s*\.ignoresSafeArea\(\)/);
});

test("native session controls keep write and end actions beside the shutter", () => {
  assert.match(sharedCameraSessionControlsSwiftSource, /private var connectionSlot: some View/);
  assert.match(sharedCameraSessionControlsSwiftSource, /private var finishSlot: some View[\s\S]*title: "End"[\s\S]*accessibilityLabel: "End session"/);
  assert.match(sharedCameraSessionControlsSwiftSource, /connectionSlot[\s\S]*Spacer\(\)[\s\S]*finishSlot[\s\S]*shutterButton/);
  assert.doesNotMatch(sharedCameraSessionControlsSwiftSource, /CapturedPhotoStrip|leadingSlot|sessionItemCount/);
});

test("native photo capture follows the phone sideways without unlocking portrait", () => {
  assert.match(captureOrientationSwiftSource, /enum CaptureOrientation: String, CaseIterable/);
  assert.match(captureOrientationSwiftSource, /init\?\(deviceOrientation: UIDeviceOrientation\)/);
  assert.match(
    captureOrientationSwiftSource,
    /var controlRotationDegrees: Double \{\s*switch self \{\s*case \.portrait:\s*0\s*case \.portraitUpsideDown:\s*180\s*case \.landscapeLeft:\s*90\s*case \.landscapeRight:\s*-90/
  );
  assert.match(
    captureOrientationSwiftSource,
    /var videoRotationAngle: CGFloat \{\s*switch self \{\s*case \.portrait:\s*90\s*case \.portraitUpsideDown:\s*270\s*case \.landscapeLeft:\s*0\s*case \.landscapeRight:\s*180/
  );
  assert.match(cameraModelSwiftSource, /func capturePhoto\(matchingDeviceOrientation: Bool = false\) async -> UIImage\?/);
  assert.match(
    cameraModelSwiftSource,
    /applyCaptureRotationAngle\(matchingDeviceOrientation \? captureOrientation : \.portrait\)/
  );
  assert.match(cameraModelSwiftSource, /guard connection\.isVideoRotationAngleSupported\(angle\) else \{ return \}/);
  // Text and barcode crops are measured against the portrait preview, so only photos re-tag.
  assert.match(scannerStoreCaptureActionsSwiftSource, /camera\.capturePhoto\(matchingDeviceOrientation: true\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /guard let image = await camera\.capturePhoto\(\) else \{ return \}/);
  assert.match(cameraModelSwiftSource, /func start\(\) \{[\s\S]*startObservingDeviceOrientation\(\)/);
  assert.match(cameraModelSwiftSource, /func stop\(\) \{\s*stopObservingDeviceOrientation\(\)/);
  assert.match(captureSessionViewSwiftSource, /controlRotation: \.degrees\(store\.camera\.captureOrientation\.controlRotationDegrees\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func capturePhoto\(matchingDeviceOrientation: Bool = false\) async throws -> UIImage/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /startObservingDeviceOrientation\(\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /applyCaptureRotationAngle\(matchingDeviceOrientation \? captureOrientation : \.portrait\)/);
  assert.match(clipViewsSwiftSource, /matchingDeviceOrientation: mode == \.photo/);
  assert.match(clipViewsSwiftSource, /controlRotation: \.degrees\(cameraService\.captureOrientation\.controlRotationDegrees\)/);
  assert.match(
    clipInfoPlistSource,
    /UIInterfaceOrientationPortrait[\s\S]*UIInterfaceOrientationPortraitUpsideDown/
  );
  assert.match(sharedCameraSessionControlsSwiftSource, /var controlRotation: Angle = \.zero/);
  assert.match(sharedCameraSessionControlsSwiftSource, /var rotation: Angle = \.zero/);
});

test("native first launch opens capture without pairing or requesting camera early", () => {
  assert.doesNotMatch(rootViewSwiftSource, /Pairing|Reconnect|connectionStatus|updateAppIsInBackground/);
  assert.match(rootViewSwiftSource, /store\.cloudWorkspace\.requestSync\(\)/);
  assert.doesNotMatch(rootViewSwiftSource, /store\.camera\.requestAccess\(\)/);
  assert.match(captureSessionViewSwiftSource, /\.task \{\s*await store\.camera\.requestAccess\(\)\s*syncCameraForCaptureState/);
  assert.match(sharedPairingSessionComponentsSwiftSource, /private let webScannerURLText = "voltresale\.app\/clip"/);
  assert.match(sharedPairingSessionComponentsSwiftSource, /Text\("Scan the QR code from the Chrome extension, or open the App Clip page on your computer\. This iPhone will connect to that browser session\."\)/);
});

test("native scanner normalizes UPC-A barcodes and preserves upload selection order", () => {
  assert.match(scannerStoreCaptureActionsSwiftSource, /normalizedBarcodeScan\(value: value, format: camera\.lastBarcodeFormat \?\? "barcode"\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /trimmedValue\.count == 13/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /trimmedValue\.first == "0"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /return \(String\(trimmedValue\.dropFirst\(\)\), "upc_a"\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /let capturedAt = now\.addingTimeInterval\(Double\(index\) \/ 1000\)/);
  assert.ok(scannerStoreCaptureActionsSwiftSource.includes('value: "Upload \\(index + 1)"'));
});

test("native barcode scanning favors guided UPC codes over adjacent supplemental barcodes", () => {
  assert.match(cameraModelSwiftSource, /private struct BarcodeCandidate/);
  assert.match(cameraModelSwiftSource, /barcodeGuideOverlapRatio\(candidate\.bounds, guideRect\) >= 0\.35/);
  assert.match(cameraModelSwiftSource, /let retailCandidates = guidedCandidates\.filter\(isRetailUPCorEAN\)/);
  assert.match(cameraModelSwiftSource, /let selectableCandidates = retailCandidates\.isEmpty \? guidedCandidates : retailCandidates/);
  assert.match(cameraModelSwiftSource, /private func barcodeGuideScore/);
  assert.match(cameraModelSwiftSource, /if isSupplementalRetailCode\(candidate\.value\) \{\s*score \+= 4_000\s*\}/);
  assert.match(cameraModelSwiftSource, /score -= widthRatio \* 480/);
});

test("native barcode recognition defaults to UPC with settings override", () => {
  assert.match(cameraModelSwiftSource, /enum BarcodeRecognitionMode: String, CaseIterable, Identifiable/);
  assert.match(cameraModelSwiftSource, /case upc = "upc"/);
  assert.match(cameraModelSwiftSource, /var barcodeRecognitionMode: BarcodeRecognitionMode = \.upc/);
  assert.match(cameraModelSwiftSource, /case \.upc:\s*\[\.ean13, \.ean8, \.upce\]/);
  assert.match(cameraModelSwiftSource, /case \.all:\s*Self\.allSupportedMetadataObjectTypes/);
  assert.match(cameraModelSwiftSource, /func updateBarcodeRecognitionMode\(_ mode: BarcodeRecognitionMode\)/);
  assert.match(scannerStoreSwiftSource, /static let barcodeRecognitionModeStorageKey = "volt\.barcodeRecognitionMode\.v1"/);
  assert.match(scannerStoreSwiftSource, /var barcodeRecognitionMode: BarcodeRecognitionMode = \.upc/);
  assert.match(scannerStoreSwiftSource, /UserDefaults\.standard\.set\(barcodeRecognitionMode\.rawValue, forKey: Self\.barcodeRecognitionModeStorageKey\)/);
  assert.match(scannerStoreSwiftSource, /camera\.updateBarcodeRecognitionMode\(barcodeRecognitionMode\)/);
  assert.match(rootViewSwiftSource, /SettingsView\(showsAccountSettings: showsAccountSettings\)/);
  assert.match(settingsViewSwiftSource, /Picker\("Recognized Codes", selection: \$store\.barcodeRecognitionMode\)/);
  assert.match(settingsViewSwiftSource, /ForEach\(BarcodeRecognitionMode\.allCases\)/);
});

test("native barcode reticles expire when detections stop refreshing", () => {
  assert.match(cameraModelSwiftSource, /private var barcodeDetectionRevision = 0/);
  assert.match(cameraModelSwiftSource, /private var barcodeClearTask: Task<Void, Never>\?/);
  assert.match(cameraModelSwiftSource, /func clearDetectedBarcode\(\) \{\s*barcodeDetectionRevision \+= 1\s*barcodeClearTask\?\.cancel\(\)\s*barcodeClearTask = nil/);
  assert.match(cameraModelSwiftSource, /scheduleStaleBarcodeClear\(\)/);
  assert.match(cameraModelSwiftSource, /try\? await Task\.sleep\(for: \.milliseconds\(450\)\)/);
  assert.match(cameraModelSwiftSource, /self\.barcodeDetectionRevision == revision/);
  assert.match(cameraModelSwiftSource, /self\.clearDetectedBarcode\(\)/);
});

test("native barcode reticle only renders in barcode capture mode", () => {
  assert.match(scannerCameraLayerSwiftSource, /guard store\.activeMode == \.barcode else \{\s*store\.camera\.updateBarcodeGuideRect\(nil\)\s*store\.camera\.clearDetectedBarcode\(\)/);
  assert.match(scannerCameraLayerSwiftSource, /store\.camera\.updateBarcodeGuideRect\(nil\)/);
  assert.match(scannerCameraLayerSwiftSource, /if guideVisible,\s*store\.activeMode == \.barcode,\s*let barcodeBounds = store\.camera\.detectedBarcodeBounds/);
});

test("native camera resets capture sessions to display 1x zoom", () => {
  const startSource = cameraModelSwiftSource.slice(
    cameraModelSwiftSource.indexOf("func start()"),
    cameraModelSwiftSource.indexOf("func stop()")
  );

  assert.match(startSource, /resetZoomToDisplayOne\(for: videoDevice\)/);
  assert.match(cameraZoomControllerSwiftSource, /enum CameraZoomController/);
  assert.match(cameraZoomControllerSwiftSource, /static func rawZoomFactorForDisplayOne\(on device: AVCaptureDevice\) -> CGFloat/);
  assert.match(cameraZoomControllerSwiftSource, /static func resetToDisplayOne\(on device: AVCaptureDevice\) throws -> CameraZoomState/);
  assert.match(cameraModelSwiftSource, /nonisolated private func resetZoomToDisplayOne\(for device: AVCaptureDevice\)/);
  assert.match(cameraModelSwiftSource, /CameraZoomController\.resetToDisplayOne\(on: device\)/);
  assert.match(cameraZoomControllerSwiftSource, /device\.videoZoomFactor = clampedFactor/);
  assert.match(cameraModelSwiftSource, /applyZoomState\(state\)/);
});

test("native camera uses fast continuous near focus for barcode scanning", () => {
  assert.match(cameraDeviceSelectorSwiftSource, /configureNativeVirtualDeviceSwitching\(on device: AVCaptureDevice\)/);
  assert.match(cameraDeviceSelectorSwiftSource, /applySmoothTapFocus\(on device: AVCaptureDevice, point: CGPoint\)/);
  assert.match(cameraDeviceSelectorSwiftSource, /applyBarcodeFocus\(on device: AVCaptureDevice, point: CGPoint\)/);
  assert.match(cameraDeviceSelectorSwiftSource, /isSmoothAutoFocusEnabled = true/);
  assert.match(cameraDeviceSelectorSwiftSource, /isSmoothAutoFocusEnabled = false/);
  assert.match(cameraDeviceSelectorSwiftSource, /isAutoFocusRangeRestrictionSupported/);
  assert.match(cameraDeviceSelectorSwiftSource, /autoFocusRangeRestriction = \.near/);
  assert.match(cameraDeviceSelectorSwiftSource, /focusMode = \.autoFocus/);
  assert.match(cameraDeviceSelectorSwiftSource, /focusMode = \.continuousAutoFocus/);
  assert.match(cameraDeviceSelectorSwiftSource, /exposureMode = \.autoExpose/);
  assert.match(cameraDeviceSelectorSwiftSource, /exposureMode = \.continuousAutoExposure/);
  assert.match(cameraDeviceSelectorSwiftSource, /isSubjectAreaChangeMonitoringEnabled = true/);
  assert.match(cameraDeviceSelectorSwiftSource, /primaryConstituentDeviceSwitchingBehavior != \.unsupported/);
  assert.doesNotMatch(cameraDeviceSelectorSwiftSource, /fallbackPrimaryConstituentDevices = \[\]/);
  assert.match(
    cameraDeviceSelectorSwiftSource,
    /setPrimaryConstituentDeviceSwitchingBehavior\(\s*\.auto,\s*restrictedSwitchingBehaviorConditions: \[\]\s*\)/
  );
  assert.match(cameraModelSwiftSource, /CameraDeviceSelector\.configureNativeVirtualDeviceSwitching\(on: camera\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraDeviceSelector\.configureNativeVirtualDeviceSwitching\(on: camera\)/);
  assert.match(cameraModelSwiftSource, /func setBarcodeScanningEnabled\(_ enabled: Bool\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func setBarcodeScanningEnabled\(_ enabled: Bool\)/);
  assert.match(scannerCameraLayerSwiftSource, /store\.camera\.setBarcodeScanningEnabled\(store\.activeMode == \.barcode\)/);
  assert.match(clipViewsSwiftSource, /cameraService\.setBarcodeScanningEnabled\(activeMode == \.barcode\)/);
  assert.match(cameraModelSwiftSource, /CameraDeviceSelector\.applyBarcodeFocus\(on: videoDevice, point: point\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraDeviceSelector\.applyBarcodeFocus\(on: videoDevice, point: point\)/);
  assert.match(cameraModelSwiftSource, /CameraDeviceSelector\.applySmoothTapFocus\(on: videoDevice, point: point\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraDeviceSelector\.applySmoothTapFocus\(on: videoDevice, point: point\)/);
});

test("native tap focus confirms camera configuration before showing feedback in every mode", () => {
  assert.match(cameraModelSwiftSource, /func focus\(at point: CGPoint\) async -> Bool/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func focus\(at point: CGPoint\) async -> Bool/);
  assert.match(cameraModelSwiftSource, /withCheckedContinuation/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /withCheckedContinuation/);
  assert.match(
    scannerCameraLayerSwiftSource,
    /let requestID = UUID\(\)[\s\S]*let focusApplied = await store\.camera\.focus\(at: devicePoint\)[\s\S]*guard focusApplied, focusRequestID == requestID else \{ return \}[\s\S]*focusPoint = layerPoint/
  );
  assert.match(
    clipViewsSwiftSource,
    /let requestID = UUID\(\)[\s\S]*let focusApplied = await cameraService\.focus\(at: devicePoint\)[\s\S]*guard focusApplied, focusRequestID == requestID else \{ return \}[\s\S]*focusPoint = layerPoint/
  );
  assert.match(captureSessionViewSwiftSource, /if store\.activeMode == \.dictation[\s\S]*\.allowsHitTesting\(false\)/);
  assert.match(clipViewsSwiftSource, /if activeMode == \.dictation[\s\S]*\.allowsHitTesting\(false\)/);
});

test("native camera shares smooth display zoom for pinch and controls", () => {
  assert.match(cameraZoomControllerSwiftSource, /enum CameraZoomGesturePhase/);
  assert.match(cameraZoomControllerSwiftSource, /private static let zoomRampRate: Float = 4/);
  assert.match(cameraZoomControllerSwiftSource, /private static let gestureZoomSensitivity: CGFloat = 0\.72/);
  assert.match(cameraZoomControllerSwiftSource, /forDisplayZoomDelta delta: CGFloat/);
  assert.match(cameraZoomControllerSwiftSource, /forDisplayZoomScale scale: CGFloat/);
  assert.match(cameraZoomControllerSwiftSource, /adjustedGestureScale\(scale\)/);
  assert.match(cameraZoomControllerSwiftSource, /device\.ramp\(toVideoZoomFactor: clampedFactor, withRate: zoomRampRate\)/);
  assert.match(cameraModelSwiftSource, /setDisplayZoomFactor\(displayZoomFactor \+ delta, ramping: true\)/);
  assert.match(cameraModelSwiftSource, /private var zoomGestureStartDisplayFactor: CGFloat\?/);
  assert.match(cameraModelSwiftSource, /func handleZoomGesture\(scale: CGFloat, phase: CameraZoomGesturePhase\)/);
  assert.match(cameraModelSwiftSource, /currentDisplayZoomFactor: startDisplayZoomFactor/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /forDisplayZoomDelta: delta,[\s\S]*currentDisplayZoomFactor: displayZoomFactor/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /private var zoomGestureStartDisplayFactor: CGFloat\?/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func handleZoomGesture\(scale: CGFloat, phase: CameraZoomGesturePhase\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /currentDisplayZoomFactor: startDisplayZoomFactor/);
  assert.match(cameraModelSwiftSource, /CameraZoomController\.setRawZoomFactor\([\s\S]*ramping: ramping/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraZoomController\.setRawZoomFactor\([\s\S]*ramping: ramping/);
  assert.doesNotMatch(cameraPreviewSwiftSource, /recognizer\.scale = 1/);
});

test("native camera clears stale torch state when capture sessions stop", () => {
  const stopSource = cameraModelSwiftSource.slice(
    cameraModelSwiftSource.indexOf("func stop()"),
    cameraModelSwiftSource.indexOf("func clearDetectedBarcode()")
  );
  const clipStopSource = clipBarcodeScannerServiceSwiftSource.slice(
    clipBarcodeScannerServiceSwiftSource.indexOf("func stop()"),
    clipBarcodeScannerServiceSwiftSource.indexOf("func setLiveTextScanningEnabled")
  );

  assert.match(stopSource, /setTorchEnabled\(false\)/);
  assert.match(cameraModelSwiftSource, /guard let videoDevice, videoDevice\.hasTorch else \{\s*torchEnabled = false\s*return\s*\}/);
  assert.match(clipStopSource, /setTorchEnabled\(false\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /guard let videoDevice, videoDevice\.hasTorch else \{\s*torchEnabled = false\s*onCameraStateChanged\?\(\)\s*return\s*\}/);
});

test("camera mode scrolling commits after settling, keeps Audio last, and gives AI one selection", () => {
  assert.match(
    sharedCameraSessionControlsSwiftSource,
    /modeButton\("Text", mode: \.ocr\)[\s\S]*modeButton\("Barcode", mode: \.barcode\)[\s\S]*modeButton\("Photo", mode: \.photo\)[\s\S]*if showsProductScanner[\s\S]*productModeButton[\s\S]*modeButton\("Audio", mode: \.dictation\)/
  );
  assert.match(
    sharedCameraSessionControlsSwiftSource,
    /\.onScrollPhaseChange[\s\S]*newPhase == \.idle[\s\S]*selectCenteredMode\(modeID\)/
  );
  assert.match(
    sharedCameraSessionControlsSwiftSource,
    /\.scrollTargetBehavior\(\.viewAligned\(limitBehavior: \.never, anchor: \.center\)\)/
  );
  assert.doesNotMatch(sharedCameraSessionControlsSwiftSource, /alwaysByOne/);
  assert.match(
    sharedCameraSessionControlsSwiftSource,
    /\.onChange\(of: selectedModeID\)[\s\S]*guard centeredModeID != modeID else \{ return \}[\s\S]*centeredModeID = modeID/
  );
  assert.match(
    sharedCameraSessionControlsSwiftSource,
    /newPhase == \.idle[\s\S]*Task \{ @MainActor in[\s\S]*await Task\.yield\(\)[\s\S]*guard !isModePickerScrolling/
  );
  assert.doesNotMatch(
    sharedCameraSessionControlsSwiftSource,
    /\.onChange\(of: centeredModeID\)[\s\S]*selectCenteredMode\(modeID\)/
  );
  assert.match(sharedCameraSessionControlsSwiftSource, /\.sensoryFeedback\(\.selection, trigger: selectedModeID\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /private let controlDeckHeight: CGFloat = \d+/);
  assert.match(sharedCameraSessionControlsSwiftSource, /private let cameraToolsVerticalOffset: CGFloat = -\d+/);
  assert.match(sharedCameraSessionControlsSwiftSource, /cameraToolsRow[\s\S]*\.offset\(y: cameraToolsVerticalOffset\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /\.frame\(height: controlDeckHeight\)/);
  assert.match(
    sharedCameraSessionControlsSwiftSource,
    /case \.capture\(let mode\):[\s\S]*onDeactivateProductScanner\?\(\)[\s\S]*activeMode = mode[\s\S]*case \.productScanner:[\s\S]*onSelectProductScanner\?\(\)/
  );
  assert.match(
    sharedCameraSessionControlsSwiftSource,
    /let isSelected = !isProductScannerSelected && activeMode == mode/
  );
});
