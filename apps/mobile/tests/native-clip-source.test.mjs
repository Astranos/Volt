import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { scannerProtocolGolden } from "@volt/scanner-protocol/protocol-fixtures";
import { readClipView } from "./clip-view-sources.mjs";
import {
  scannerStoreSwiftSource,
  scannerStoreCaptureActionsSwiftSource,
  rootViewSwiftSource,
  scannerViewSwiftSource,
  captureSessionViewSwiftSource,
  sharedCameraSessionControlsSwiftSource,
  sharedScannerTabComponentsSwiftSource,
  sharedCaptureSessionOverlaysSwiftSource,
  uploadViewSwiftSource,
  clipViewsSwiftSource,
  clipBarcodeScannerServiceSwiftSource,
  clipScannerStoreSwiftSource,
  clipGuestCloudClientSwiftSource,
  clipOCRServiceSwiftSource,
  xcodeProjectSource,
} from "./native-source-fixtures.mjs";

test("App Clip uses a cloud-only workspace session without background peer state", () => {
  assert.match(clipScannerStoreSwiftSource, /AppClipGuestCloudSession\(pairingSession: nextSession\)/);
  assert.match(clipScannerStoreSwiftSource, /guestCloudClient\.listComputers\(session: cloudSession\)/);
  assert.doesNotMatch(clipViewsSwiftSource, /scenePhase|ClipWebRTCBridgeView/);
  assert.doesNotMatch(clipScannerStoreSwiftSource, /reconnectTask|transport|signaling/);
});

test("app clip capture sessions keep one photo batch per presented camera session", () => {
  assert.match(clipViewsSwiftSource, /@State private var captureSessionBatchId: String\?/);
  assert.match(clipViewsSwiftSource, /captureSessionBatchId = store\.beginCaptureSession\(\)/);
  assert.match(clipViewsSwiftSource, /store\.endCaptureSession\(id: captureSessionBatchId\)/);
  assert.match(clipViewsSwiftSource, /captureBatchId: captureSessionBatchId/);
  assert.match(clipViewsSwiftSource, /await store\.capturePhoto\(image, batchId: batchId\)/);
  assert.match(clipScannerStoreSwiftSource, /func beginCaptureSession\(\) -> String/);
  assert.match(clipScannerStoreSwiftSource, /let batchId = Self\.makeMessageId\("batch"\)/);
  assert.match(clipScannerStoreSwiftSource, /func endCaptureSession\(id: String\? = nil\)/);
  assert.match(clipScannerStoreSwiftSource, /if let id, activeCaptureBatchId != id \{\s*return\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /func capturePhoto\(_ image: UIImage, batchId: String\? = nil\) async/);
  assert.match(clipScannerStoreSwiftSource, /batchId: batchId \?\? currentCaptureBatchId\(\)/);
});

test("native and app clip can reopen photo capture into a selected batch", () => {
  assert.match(scannerStoreSwiftSource, /var capturePhotoBatch: \(id: String, expiresAt: Date\)\?/);
  assert.match(scannerStoreSwiftSource, /var resumedPhotoBatchId: String\?/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func resumePhotoBatch\(id: String\) \{[\s\S]*resumeCaptureSession\(batchId: id\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func endResumedPhotoBatch\(\) \{[\s\S]*endCaptureSession\(\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func currentPhotoBatch\(now: Date\) -> String \{[\s\S]*if let activeCaptureBatchId \{[\s\S]*return activeCaptureBatchId/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func captureSquarePhoto\(\) async \{\s*let batchId = currentCaptureBatchId\(\)[\s\S]*sendPhoto\(preparedImage, result: photoResult, batchId: batchId\)/);
  assert.match(scannerViewSwiftSource, /CaptureHistorySessionCard\(/);
  assert.match(scannerViewSwiftSource, /Continue session/);
  assert.match(captureSessionViewSwiftSource, /\.onAppear \{\s*store\.activeMode = mode/);
  assert.doesNotMatch(captureSessionViewSwiftSource, /\.onAppear \{\s*store\.activeMode = \.ocr/);

  assert.match(clipScannerStoreSwiftSource, /func resumeCaptureSession\(batchId: String\) -> String \{\s*activeCaptureBatchId = batchId\s*return batchId\s*\}/);
  assert.match(clipViewsSwiftSource, /Label\("Add Photos", systemImage: "plus\.viewfinder"\)/);
  assert.match(clipViewsSwiftSource, /store\.activeCaptureMode = \.ocr\s*captureSessionBatchId = store\.resumeCaptureSession\(batchId: batchId\)\s*isCaptureSessionPresented = true/);
  assert.match(clipViewsSwiftSource, /let batchId = captureBatchId[\s\S]*onCaptureImage\(image, mode, batchId\)/);
  assert.match(clipViewsSwiftSource, /store\.activeCaptureMode = \.ocr\s*captureSessionBatchId = store\.beginCaptureSession\(\)/);
  assert.doesNotMatch(clipViewsSwiftSource, /\.onAppear \{\s*activeMode = \.ocr/);
});

test("app clip photo mode viewfinder stays edge-to-edge while capture status changes", () => {
  assert.match(clipViewsSwiftSource, /if activeMode == \.photo, ocrReviewImage == nil \{[\s\S]*GeometryReader/);
  assert.match(clipViewsSwiftSource, /let side = previewGeometry\.size\.width/);
  assert.doesNotMatch(clipViewsSwiftSource, /let side = min\(previewGeometry\.size\.width, previewGeometry\.size\.height\)/);
  assert.match(clipViewsSwiftSource, /\.frame\(maxWidth: \.infinity, maxHeight: \.infinity, alignment: \.top\)/);
});

test("app clip audio is an in-camera mode with final text in the active batch", () => {
  assert.match(sharedCameraSessionControlsSwiftSource, /modeButton\("Audio", mode: \.dictation\)/);
  assert.match(clipViewsSwiftSource, /store\.toggleDictation\(\)/);
  assert.match(clipViewsSwiftSource, /store\.dictationTranscript/);
  assert.match(clipScannerStoreSwiftSource, /SpeechDictationService\(\)/);
  assert.match(clipScannerStoreSwiftSource, /sendCapture\(mode: \.dictation, value: trimmed/);
  assert.match(clipGuestCloudClientSwiftSource, /batchId: String\? = nil/);
  assert.match(clipScannerStoreSwiftSource, /case \.dictation: "text"/);
});

test("installed app removes pairing headers while App Clip keeps connection controls", () => {
  assert.doesNotMatch(rootViewSwiftSource, /ScannerSectionHeader|ScannerConnectionSummary|PairingStatusSheet/);
  assert.doesNotMatch(scannerViewSwiftSource, /PairingSessionsView|isSessionsPresented|onConnectionControlTapped/);
  assert.doesNotMatch(uploadViewSwiftSource, /PairingSessionsView|isSessionsPresented|onConnectionControlTapped/);
  assert.match(scannerViewSwiftSource, /CloudTargetButton/);
  assert.match(clipViewsSwiftSource, /private func clipConnectionTitle\(/);
  assert.match(clipViewsSwiftSource, /if isPairing \{\s*return "Connecting"\s*\}/);
  assert.match(clipViewsSwiftSource, /struct ClipPairingFailureView: View/);
  assert.match(clipViewsSwiftSource, /Label\("Scan QR Code", systemImage: "qrcode\.viewfinder"\)/);
  assert.doesNotMatch(clipViewsSwiftSource, /struct ClipPairingSessionsView: View/);
});

test("app clip uses the same app icon resource as the main app", () => {
  assert.match(xcodeProjectSource, /B0000000000000000000001B \/\* volt\.icon in Resources \*\//);
  assert.match(xcodeProjectSource, /B3000000000000000000001E \/\* volt\.icon in Resources \*\//);
  assert.match(xcodeProjectSource, /H30000000000000000000001 \/\* Resources \*\/ = \{[\s\S]*B3000000000000000000001E \/\* volt\.icon in Resources \*\//);
  const clipConfigStart = xcodeProjectSource.indexOf("J30000000000000000000001 /* Debug */");
  const clipConfigSource = xcodeProjectSource.slice(clipConfigStart, xcodeProjectSource.indexOf("J400", clipConfigStart) === -1 ? undefined : xcodeProjectSource.indexOf("J400", clipConfigStart));
  assert.ok(clipConfigStart > -1);
  assert.match(clipConfigSource, /ASSETCATALOG_COMPILER_APPICON_NAME = volt/g);
  assert.doesNotMatch(clipConfigSource, /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon/);
});

test("native app and App Clip preserve color when preparing engraved serials for OCR", () => {
  assert.match(scannerStoreCaptureActionsSwiftSource, /colorControls\.contrast = 1\.18/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /colorControls\.brightness = 0\.02/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /colorControls\.saturation = 0\.92/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /sharpen\.sharpness = 0\.42/);
  assert.match(clipOCRServiceSwiftSource, /kCIInputContrastKey: 1\.18/);
  assert.match(clipOCRServiceSwiftSource, /kCIInputBrightnessKey: 0\.02/);
  assert.match(clipOCRServiceSwiftSource, /kCIInputSaturationKey: 0\.92/);
  assert.match(clipOCRServiceSwiftSource, /kCIInputSharpnessKey: 0\.42/);
});

test("app clip capture controls are wired to camera hardware actions", () => {
  assert.match(clipViewsSwiftSource, /torchEnabled: cameraService\.torchEnabled/);
  assert.match(clipViewsSwiftSource, /zoomLabel: cameraService\.zoomDisplayLabel/);
  assert.match(clipViewsSwiftSource, /cameraService\.setTorchEnabled\(!cameraService\.torchEnabled\)/);
  assert.match(clipViewsSwiftSource, /onRetake: \{\s*resetSelectedText\(\)\s*cameraService\.setTorchEnabled\(false\)\s*onClearOcrReview\(\)/);
  assert.match(
    clipViewsSwiftSource,
    /private func syncCameraForOcrPostCapture\(\) \{[\s\S]*let shouldPauseCamera = activeMode == \.ocr\s*&& \(isRecognizingText \|\| ocrReviewImage != nil\)[\s\S]*cameraService\.stop\(\)[\s\S]*cameraService\.start\(\)/
  );
  assert.match(clipViewsSwiftSource, /\.onChange\(of: ocrReviewImage != nil\) \{ _, isReviewing in\s*syncCameraForOcrPostCapture\(\)[\s\S]*resetSelectedText\(\)/);
  assert.match(clipViewsSwiftSource, /cameraService\.adjustZoom\(by: -0\.25\)/);
  assert.match(clipViewsSwiftSource, /cameraService\.adjustZoom\(by: 0\.25\)/);
  assert.doesNotMatch(clipViewsSwiftSource, /onToggleTorch: \{\}/);
  assert.doesNotMatch(clipViewsSwiftSource, /onZoomOut: \{\}/);
  assert.doesNotMatch(clipViewsSwiftSource, /onZoomIn: \{\}/);
});

test("app clip camera preview supports tap focus and pinch zoom", () => {
  assert.match(clipViewsSwiftSource, /UITapGestureRecognizer\(target: self, action: #selector\(handleTap\(_:\)\)\)/);
  assert.match(clipViewsSwiftSource, /UIPinchGestureRecognizer\(target: self, action: #selector\(handlePinch\(_:\)\)\)/);
  assert.match(clipViewsSwiftSource, /captureDevicePointConverted\(fromLayerPoint: layerPoint\)/);
  assert.match(clipViewsSwiftSource, /cameraService\.focus\(at: devicePoint\)/);
  assert.match(clipViewsSwiftSource, /cameraService\.handleZoomGesture\(scale: scale, phase: phase\)/);
  assert.doesNotMatch(clipViewsSwiftSource, /recognizer\.scale = 1/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /struct FocusReticle: View/);
  assert.match(clipViewsSwiftSource, /FocusReticle\(\)/);
});

test("app clip camera service supports zoom, torch, focus, and UPC-A priority", () => {
  assert.match(clipBarcodeScannerServiceSwiftSource, /private\(set\) var torchEnabled = false/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /private\(set\) var zoomDisplayLabel = "1x"/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /session\.sessionPreset = \.photo/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func setTorchEnabled\(_ enabled: Bool\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func adjustZoom\(by delta: CGFloat\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func scaleZoom\(by scale: CGFloat\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func focus\(at point: CGPoint\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /startRunningIfNeeded\(resetZoom: true\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /capturePhoto\(matchingDeviceOrientation: Bool = false\) async throws -> UIImage \{[\s\S]*await startRunningIfNeeded\(\)/);
  assert.doesNotMatch(clipBarcodeScannerServiceSwiftSource, /capturePhoto\(matchingDeviceOrientation: Bool = false\) async throws -> UIImage \{[\s\S]*startRunningIfNeeded\(resetZoom: true\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraZoomController\.setRawZoomFactor/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /CameraZoomController\.resetToDisplayOne\(on: device\)/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /private func upcADigitCount\(_ type: AVMetadataObject\.ObjectType, value: String\) -> Bool/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /if upcADigitCount\(type, value: value\) \{ return 0 \}/);
});

test("app clip OCR target dialog shares cleanup and styling with the main app", () => {
  assert.match(clipViewsSwiftSource, /ExtractedTextActionCard\(/);
  assert.match(clipViewsSwiftSource, /text: selectedTextPreview/);
  assert.match(clipViewsSwiftSource, /isCleaning: isCleaningSelectedText/);
  assert.match(clipViewsSwiftSource, /isShowingRaw: isShowingRawText/);
  assert.match(clipViewsSwiftSource, /let result = await OcrTextCleaner\.clean\(text: region\.text, context: context\)/);
  assert.match(clipViewsSwiftSource, /onSendRecognizedText\(selectedTextValue\)/);
  assert.match(clipViewsSwiftSource, /private func resetSelectedText\(\)/);
  assert.match(clipViewsSwiftSource, /private var selectedTextPreview: String/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /\.foregroundStyle\(\.black\)/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /Color\.white\.opacity\(0\.9\)/);
});

test("app clip capture modes share one camera and unified History area", () => {
  assert.match(clipScannerStoreSwiftSource, /var activeCaptureMode: CaptureMode = \.ocr/);
  assert.match(clipViewsSwiftSource, /ClipCaptureView\(store: store, mode: \.ocr/);
  assert.match(clipViewsSwiftSource, /ClipUnifiedHistoryView\(/);
  assert.match(clipViewsSwiftSource, /showsModePicker: true/);
  assert.match(sharedCameraSessionControlsSwiftSource, /modeButton\("Text", mode: \.ocr\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /modeButton\("Barcode", mode: \.barcode\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /modeButton\("Photo", mode: \.photo\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /modeButton\("Audio", mode: \.dictation\)/);
  assert.match(clipViewsSwiftSource, /Set\(store\.captures\.map/);
  assert.match(clipViewsSwiftSource, /CameraSessionTopStatus\([\s\S]*liveTextCandidates: liveTextCandidates/);
  assert.match(clipViewsSwiftSource, /connectionLabel: isConnected \? "Write" : "Connect"[\s\S]*onConnection: \{\s*isConnectionSheetPresented = true/);
  assert.match(clipViewsSwiftSource, /Button\("Delete session", systemImage: "trash", role: \.destructive\)/);
  assert.match(clipScannerStoreSwiftSource, /func removeSession\(batchId: String\)/);
  assert.match(clipViewsSwiftSource, /private var sessionIDs: \[String\]/);
  assert.match(clipViewsSwiftSource, /let photos = store\.photos\.filter/);
  assert.match(clipViewsSwiftSource, /ClipPhotoLibraryUploadSection\(store: store\)[\s\S]*ClipUnifiedHistoryView\(store: store\)/);
  assert.match(clipViewsSwiftSource, /ClipPhotoBatchCard\(/);
  assert.doesNotMatch(clipViewsSwiftSource, /Recent Uploads|ClipUploadPhotoBatchesSection/);
  assert.doesNotMatch(clipViewsSwiftSource, /capturedSessionPhotos|capturedThumbnails|capturedSessionItemCount/);
});

test("app clip main Scan surface exposes the photo-library upload control without a mode gate", () => {
  const scanSource = readClipView("ClipCaptureHomeView.swift");
  const uploadControl = scanSource.indexOf("ClipPhotoLibraryUploadSection(store: store)");
  const photoModeGate = scanSource.indexOf("if mode == .photo");

  assert.match(scanSource, /struct ClipCaptureView: View/);
  assert.ok(uploadControl > -1);
  assert.ok(photoModeGate === -1 || uploadControl < photoModeGate);
});

test("app clip captured photos are grouped, previewable, and removable after leaving camera", () => {
  assert.doesNotMatch(clipViewsSwiftSource, /expandedBatchIds/);
  assert.match(clipViewsSwiftSource, /@State private var previewedPhoto: ClipScannerStore\.ClipPhoto\?/);
  assert.match(clipViewsSwiftSource, /let photos = store\.photos\.filter \{ \(\$0\.batchId \?\? \$0\.id\.uuidString\.lowercased\(\)\) == id \}/);
  assert.match(clipViewsSwiftSource, /\.sheet\(item: \$previewedPhoto\)/);
  assert.match(clipViewsSwiftSource, /struct ClipPhotoBatchCard: View/);
  assert.match(clipViewsSwiftSource, /private var visiblePhotos: \[ClipScannerStore\.ClipPhoto\] \{\s*Array\(batch\.photos\.suffix\(4\)\)/);
  assert.match(clipViewsSwiftSource, /NavigationLink \{\s*ClipPhotoBatchGallery\(batch: batch, onDelete: onDeletePhoto\)/);
  assert.match(clipViewsSwiftSource, /struct ClipPhotoBatchGallery: View \{\s*@State private var previewedPhoto:[\s\S]*let batch: ClipPhotoBatch[\s\S]*ForEach\(batch\.photos\)/);
  assert.doesNotMatch(clipViewsSwiftSource, /_photos = State\(initialValue: batch\.photos\)/);
  assert.match(clipViewsSwiftSource, /accessibilityLabel\("Add photos to \\\(batch\.title\) from/);
  assert.match(clipViewsSwiftSource, /struct ClipPhotoThumbnail: View/);
  assert.match(clipViewsSwiftSource, /struct ClipPhotoPreviewSheet: View/);
  assert.match(clipViewsSwiftSource, /store\.removePhoto\(id: photo\.id\)/);
  assert.match(clipViewsSwiftSource, /store\.removePhotos\(batchId: id\)/);
  assert.match(clipScannerStoreSwiftSource, /func removePhoto\(id: UUID\)/);
  assert.match(clipScannerStoreSwiftSource, /func removePhotos\(batchId: String\)/);
});

test("app clip photo capture keeps the stable shared control geometry", () => {
  assert.match(clipViewsSwiftSource, /private let photoPreviewToolbarGap: CGFloat = 0/);
  assert.match(clipViewsSwiftSource, /captureNotice = mode == \.ocr \? "Capturing text image" : "Capturing photo"/);
  assert.match(clipViewsSwiftSource, /private func successNotice\(for mode: CaptureMode\) -> String\?/);
  assert.match(clipViewsSwiftSource, /case \.photo, \.dictation:\s*nil/);
  assert.match(clipViewsSwiftSource, /CameraSessionControls\([\s\S]*onConnection: \{\s*isConnectionSheetPresented = true[\s\S]*onFinish: \{\s*dismiss\(\)/);
  assert.doesNotMatch(clipViewsSwiftSource, /hasLatestCapture|onSendLatest/);
});

test("app clip photo sessions capture immediately without an extra review step", () => {
  assert.match(clipScannerStoreSwiftSource, /private func prepareCapturedPhoto\(_ image: UIImage\) -> UIImage/);
  assert.match(clipScannerStoreSwiftSource, /let preparedImage = prepareCapturedPhoto\(image\)/);
  assert.match(clipViewsSwiftSource, /else if mode == \.photo \{\s*onCaptureImage\(image, mode, batchId\)\s*captureNotice = nil/);
  assert.doesNotMatch(clipViewsSwiftSource, /photoReviewImage|ClipPhotoReviewControls|Use Photo|Review photo/);
});

test("app clip bottom CTAs show connection progress while pairing", () => {
  assert.match(sharedScannerTabComponentsSwiftSource, /var isConnecting = false/);
  assert.match(sharedScannerTabComponentsSwiftSource, /isConnecting \? "Connecting\.\.\." : title/);
  assert.match(sharedScannerTabComponentsSwiftSource, /isConnecting \? "hourglass" : systemImage/);
  assert.match(sharedScannerTabComponentsSwiftSource, /if isConnecting \{\s*return "Connecting\.\.\."\s*\}/);
  assert.match(sharedScannerTabComponentsSwiftSource, /\.background\(\.bar\)\s*\.shadow\(color: \.black\.opacity\(0\.12\), radius: 10, y: -3\)/);
  assert.match(clipViewsSwiftSource, /ScannerHomeControls\([\s\S]*onScan: startCapture/);
  assert.match(clipViewsSwiftSource, /ClipChromeSectionHeader\([\s\S]*connection: connectionSummary/);
  assert.match(clipViewsSwiftSource, /ScannerPhotoPickerAccessory\([\s\S]*isConnecting: store\.isPairing[\s\S]*statusText: uploadStatusText/);
  assert.match(clipViewsSwiftSource, /private var captureStatusText: String \{\s*if store\.isPairing \{\s*store\.statusText/);
  assert.match(clipViewsSwiftSource, /private var uploadStatusText: String \{[\s\S]*else if store\.isPairing \{\s*status = store\.statusText/);
  assert.doesNotMatch(clipViewsSwiftSource, /Label\(\s*"Start Dictation",\s*systemImage: "mic\.fill"/);
  assert.doesNotMatch(clipViewsSwiftSource, /Button\(store\.isSendingDictation \? "Sending…" : "Send"\)/);
});

test("app clip combines capture and history in one home with shared controls", () => {
  assert.doesNotMatch(clipViewsSwiftSource, /TabView\(|\.tabItem/);
  assert.match(clipViewsSwiftSource, /ClipCaptureView\(store: store, mode: \.ocr/);
  assert.match(clipViewsSwiftSource, /ClipCaptureLaunchCard\(action: startCapture\)/);
  assert.match(clipViewsSwiftSource, /ClipUnifiedHistoryView\(store: store\)/);
  assert.match(clipViewsSwiftSource, /ScannerHomeControls\(/);
});

test("app clip can select an online workspace computer for text and barcode insertion", () => {
  assert.match(clipViewsSwiftSource, /struct ClipWorkspaceTargetPickerSheet: View/);
  assert.match(clipViewsSwiftSource, /Section\("Workspace Computers"\)/);
  assert.match(clipViewsSwiftSource, /await store\.refreshWorkspaceComputers\(\)/);
  assert.match(clipScannerStoreSwiftSource, /var selectedWorkspaceComputerId: String\?/);
  assert.match(clipScannerStoreSwiftSource, /private func sendCaptureToWorkspace\(_ capture: ClipCapture\)/);
  assert.match(clipScannerStoreSwiftSource, /targetDeviceId: target\?\.deviceId/);
  assert.match(clipGuestCloudClientSwiftSource, /case listComputers = "api\/app-clip\/computers\/list"/);
  assert.match(clipGuestCloudClientSwiftSource, /case queueCursorDelivery = "api\/app-clip\/deliveries\/queue"/);
});

test("app clip connection is an ephemeral cloud grant with no saved peer credentials", () => {
  assert.match(clipScannerStoreSwiftSource, /private var guestCloudSession: AppClipGuestCloudSession\?/);
  assert.match(clipScannerStoreSwiftSource, /var canReconnectToLastSession: Bool \{ false \}/);
  assert.match(clipScannerStoreSwiftSource, /var lastSessionDisplayName: String\? \{ nil \}/);
  assert.doesNotMatch(clipScannerStoreSwiftSource, /PairingSecretStore|UserDefaults|StoredClipPairingCredential/);
  assert.match(clipViewsSwiftSource, /@State private var isConnectionSheetPresented = false/);
  assert.match(clipViewsSwiftSource, /struct ClipConnectChoicesView: View/);
  assert.match(clipViewsSwiftSource, /Label\("Scan QR", systemImage: "qrcode\.viewfinder"\)/);
});

test("app clip connected session button opens session actions instead of disconnecting", () => {
  assert.match(clipViewsSwiftSource, /private func handleConnectButtonTapped\(\) \{\s*isConnectionSheetPresented = true\s*\}/);
  assert.doesNotMatch(clipViewsSwiftSource, /if store\.isConnected \{\s*store\.disconnect\(\)\s*return\s*\}/);
  assert.match(clipViewsSwiftSource, /let onDisconnect: \(\) -> Void/);
  assert.match(clipViewsSwiftSource, /if store\.isConnected \{[\s\S]*Text\("Choose which workspace computer receives captures, or scan a QR code for a different workspace\."\)/);
  assert.match(clipViewsSwiftSource, /if store\.isConnected \{[\s\S]*Button\(role: \.destructive\)[\s\S]*Label\("Disconnect", systemImage: "xmark\.circle"\)[\s\S]*minHeight: 62[\s\S]*\.buttonStyle\(\.borderedProminent\)[\s\S]*\.tint\(\.red\)/);
  assert.match(clipViewsSwiftSource, /onScanQRCode: \{[\s\S]*if store\.isConnected \{\s*store\.disconnect\(\)\s*\}[\s\S]*showPairingScanner\(\)/);
});

test("app clip failure retry revalidates the scanned workspace grant", () => {
  assert.match(clipScannerStoreSwiftSource, /var canRetryConnection: Bool \{ canRetryPairing \}/);
  assert.match(clipScannerStoreSwiftSource, /func retryFailedConnection\(\) \{\s*retryPairing\(\)\s*\}/);
  assert.match(clipViewsSwiftSource, /Button \{\s*store\.retryFailedConnection\(\)\s*\} label: \{\s*Label\("Retry", systemImage: "arrow\.clockwise"\)/);
  assert.doesNotMatch(clipViewsSwiftSource, /Button \{\s*store\.retryPairing\(\)\s*\} label: \{\s*Label\("Retry", systemImage: "arrow\.clockwise"\)/);
  assert.match(clipViewsSwiftSource, /\.disabled\(!store\.canRetryConnection\)/);
});

test("app clip connection sheets use opaque backgrounds and large system actions", () => {
  assert.match(clipViewsSwiftSource, /\.presentationBackground\(Color\(uiColor: \.systemBackground\)\)/);
  assert.match(clipViewsSwiftSource, /Label\("Scan QR", systemImage: "qrcode\.viewfinder"\)[\s\S]*minHeight: 62[\s\S]*\.buttonStyle\(\.bordered\)[\s\S]*\.tint\(\.green\)/);
  assert.match(clipViewsSwiftSource, /Label\("Scan QR", systemImage: "qrcode\.viewfinder"\)[\s\S]*minHeight: 62[\s\S]*\.buttonStyle\(\.borderedProminent\)[\s\S]*\.tint\(\.green\)/);
  assert.match(clipViewsSwiftSource, /Label\("Scan QR Code", systemImage: "qrcode\.viewfinder"\)[\s\S]*minHeight: 62[\s\S]*\.buttonStyle\(\.bordered\)[\s\S]*\.tint\(\.green\)/);
});

test("app clip connecting sheet can cancel or switch to QR scanning", () => {
  assert.match(clipScannerStoreSwiftSource, /private var activeConnectionAttemptLabel: String\?/);
  assert.match(clipScannerStoreSwiftSource, /var connectionAttemptDisplayName: String \{[\s\S]*activeConnectionAttemptLabel \?\? pairingLabel \?\? "Volt workspace"[\s\S]*\}/);
  assert.match(clipScannerStoreSwiftSource, /func cancelConnectionAttempt\(\) \{[\s\S]*statusText = "Connection canceled"/);
  assert.match(clipViewsSwiftSource, /@State private var isConnectionSheetPresented = false/);
  assert.match(clipViewsSwiftSource, /\.onChange\(of: store\.isPairing\) \{ _, isPairing in\s*if isPairing \{\s*isConnectionSheetPresented = true\s*\}\s*\}/);
  assert.match(clipViewsSwiftSource, /struct ClipConnectionProgressView: View/);
  assert.match(clipViewsSwiftSource, /Text\("Connecting"\)/);
  assert.match(clipViewsSwiftSource, /value: store\.connectionAttemptDisplayName,\s*systemImage: "desktopcomputer"/);
  assert.match(clipViewsSwiftSource, /value: store\.statusText,\s*systemImage: "waveform\.path\.ecg"/);
  assert.match(clipViewsSwiftSource, /Label\("Cancel", systemImage: "xmark\.circle"\)/);
  assert.match(clipViewsSwiftSource, /Label\("Scan QR", systemImage: "qrcode\.viewfinder"\)/);
  assert.match(clipViewsSwiftSource, /store\.cancelConnectionAttempt\(\)[\s\S]*onScanQRCode\(\)/);
});

test("app clip pairing and failure reuse one connection sheet", () => {
  assert.match(clipViewsSwiftSource, /@State private var isConnectionSheetPresented = false/);
  assert.match(clipViewsSwiftSource, /\.sheet\(isPresented: \$isConnectionSheetPresented\)/);
  assert.doesNotMatch(clipViewsSwiftSource, /isConnectChoicesPresented|isConnectionProgressPresented|isPairingFailurePresented/);
  assert.match(clipViewsSwiftSource, /struct ClipConnectionSheet: View/);
  assert.match(clipViewsSwiftSource, /if store\.isPairing[\s\S]*ClipConnectionProgressView[\s\S]*else if store\.pairingFailureMessage != nil[\s\S]*ClipPairingFailureView[\s\S]*else[\s\S]*ClipConnectChoicesView/);
  assert.match(clipViewsSwiftSource, /struct ClipCaptureSessionView: View[\s\S]*\.sheet\(isPresented: \$isConnectionSheetPresented\)[\s\S]*ClipConnectionSheet\(/);
  assert.match(clipViewsSwiftSource, /\.onChange\(of: store\.isConnected\)[\s\S]*isConnectionSheetPresented = !isConnected/);
});

test("app clip fresh qr connection uses the workspace label", () => {
  assert.match(clipScannerStoreSwiftSource, /private func preparePairing\(session: PairingSession, url: URL\) \{[\s\S]*pairingLabel = session\.label[\s\S]*activeConnectionAttemptLabel = displayName\(for: session\)/);
  assert.match(clipScannerStoreSwiftSource, /private func displayName\(for session: PairingSession\) -> String \{\s*let label = session\.label\?\.trimmingCharacters\(in: \.whitespacesAndNewlines\) \?\? ""\s*return label\.isEmpty \? "Volt workspace" : label\s*\}/);
  assert.doesNotMatch(clipScannerStoreSwiftSource, /session\.label \?\? session\.sessionId/);
  assert.doesNotMatch(clipScannerStoreSwiftSource, /pairingLabel = session\.label \?\? pairingLabel/);
});

test("app clip photo capture and library upload await Convex storage", () => {
  assert.match(clipScannerStoreSwiftSource, /func capturePhoto\(_ image: UIImage, batchId: String\? = nil\) async/);
  assert.match(clipScannerStoreSwiftSource, /\.centerSquareCropped\(\)/);
  assert.match(clipScannerStoreSwiftSource, /await sendPhoto\(photo\)/);
  assert.match(clipScannerStoreSwiftSource, /func uploadPhotos\(_ images: \[UIImage\]\) async/);
  assert.match(clipScannerStoreSwiftSource, /let batchId = Self\.makeMessageId\("upload-batch"\)/);
  assert.match(clipScannerStoreSwiftSource, /let didSend = await sendPhoto\(\s*photo,\s*filename: uploadFilename\(index: index, capturedAt: capturedAt\)\s*\)/);
  assert.match(clipViewsSwiftSource, /guard !items\.isEmpty else \{ return \}/);
  assert.match(clipScannerStoreSwiftSource, /try await guestCloudClient\.mirrorPhoto\(/);
});

test("app clip unified history groups library photos with captures and shows shared upload progress", () => {
  assert.match(clipScannerStoreSwiftSource, /var photoUploadProgress: PhotoUploadProgress\?/);
  assert.match(clipScannerStoreSwiftSource, /photoUploadProgress = PhotoUploadProgress\(/);
  assert.match(clipScannerStoreSwiftSource, /updatePhotoUploadProgress\(batchId: batchId, prepared: index \+ 1, phase: \.uploading\)/);
  assert.match(clipScannerStoreSwiftSource, /finishPhotoUploadItem\(batchId: batchId, succeeded: didSend\)/);
  assert.match(clipScannerStoreSwiftSource, /finishPhotoUploadBatch\(batchId: batchId\)/);
  assert.match(clipViewsSwiftSource, /private var sessionIDs: \[String\]/);
  assert.match(clipViewsSwiftSource, /let photos = store\.photos\.filter \{ \(\$0\.batchId \?\? \$0\.id\.uuidString\.lowercased\(\)\) == id \}/);
  assert.match(clipViewsSwiftSource, /PhotoPreparationProgressSummary\(\s*prepared: selectedUploadPrepared,\s*total: selectedUploadTotal\s*\)/);
  assert.match(clipViewsSwiftSource, /PhotoUploadProgressSummary\(progress: progress\)/);
  assert.match(clipViewsSwiftSource, /ClipPhotoBatchCard\(/);
  assert.match(clipViewsSwiftSource, /struct ClipPhotoBatchCard: View/);
  assert.match(clipViewsSwiftSource, /struct ClipPhotoThumbnail: View/);
  assert.match(clipViewsSwiftSource, /let action = source == \.upload \? "uploaded" : "captured"/);
  assert.match(clipViewsSwiftSource, /if batch\.source == \.capture/);
  assert.match(clipViewsSwiftSource, /isUploading: activeUploadProgress != nil/);
  assert.match(clipViewsSwiftSource, /"Reading \\\(selectedUploadReadCount\) of \\\(selectedUploadTotal\) selected photos"/);
  assert.match(clipViewsSwiftSource, /"\\\(progress\.title\)\. \\\(progress\.detail\)\."/);
  assert.match(clipViewsSwiftSource, /store\.removePhotos\(batchId: id\)/);
  assert.doesNotMatch(clipViewsSwiftSource, /Recent Uploads/);
});

test("app clip upload picker accepts and queues more photos while a batch is active", () => {
  assert.match(clipViewsSwiftSource, /@State private var queuedUploadSelections: \[\[PhotosPickerItem\]\] = \[\]/);
  assert.match(clipViewsSwiftSource, /private func enqueueUploadSelection\(_ items: \[PhotosPickerItem\]\)/);
  assert.match(clipViewsSwiftSource, /while store\.isConnected, !queuedUploadSelections\.isEmpty/);
  assert.match(clipViewsSwiftSource, /\.onChange\(of: store\.isConnected\)[\s\S]*if isConnected \{\s*startUploadQueueIfNeeded\(\)/);
  assert.match(clipViewsSwiftSource, /pickerItems = \[\][\s\S]*enqueueUploadSelection\(items\)/);
  assert.match(clipViewsSwiftSource, /else if let progress = activeUploadProgress/);
});

test("app clip replays saved captures and photos after connecting", () => {
  assert.match(clipScannerStoreSwiftSource, /sendSavedItemsAfterConnect\(\)/);
  assert.match(clipScannerStoreSwiftSource, /private func sendSavedItemsAfterConnect\(\)/);
  assert.match(clipScannerStoreSwiftSource, /let savedPhotos = photos\.filter \{ \$0\.status == "Saved until connected" \}/);
  assert.match(clipScannerStoreSwiftSource, /for capture in captures where capture\.status == "Saved until connected" \{\s*sendCaptureToWorkspace\(capture\)\s*\}/);
  assert.match(clipScannerStoreSwiftSource, /for photo in savedPhotos \{\s*await sendPhoto\(photo\)\s*\}/);
});

test("app clip scanner restricts capture barcodes to UPC/EAN and clears stale scans", () => {
  assert.match(clipBarcodeScannerServiceSwiftSource, /static let captureMetadataObjectTypes: \[AVMetadataObject\.ObjectType\] = \[\s*\.ean13,\s*\.ean8,\s*\.upce,\s*\]/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /metadataOutput\.metadataObjectTypes = Self\.captureMetadataObjectTypes\.filter/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /func clearDetectedBarcode\(\) \{\s*barcodeDetectionRevision \+= 1\s*barcodeClearTask\?\.cancel\(\)\s*barcodeClearTask = nil\s*latestScan = nil/);
});

test("app clip OCR reuses the main async recognizer and identifier extractor", () => {
  assert.match(clipOCRServiceSwiftSource, /withCheckedThrowingContinuation/);
  assert.match(clipOCRServiceSwiftSource, /DispatchQueue\.global\(qos: \.userInitiated\)\.async/);
  assert.match(clipOCRServiceSwiftSource, /LiveTextIdentifierMatcher\.match\(text\)/);
  assert.match(clipOCRServiceSwiftSource, /candidate\.boundingBox\(for: match\.range\)/);
  assert.match(clipOCRServiceSwiftSource, /DeviceIdentifierRegionExtractor\.reviewRegions\(from: recognizedRegions\)/);
});
