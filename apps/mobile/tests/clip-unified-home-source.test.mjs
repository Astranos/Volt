import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../ios/VoltClip/Views/ClipRootView.swift", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "Missing source boundary: " + start);
  return source.slice(from, to);
};
const home = section("private struct ClipCaptureView:", "private struct ClipCaptureLaunchCard:");
const history = section("private struct ClipUnifiedHistoryView:", "private extension Array");

test("Clip home orders hero, typing target, library upload, and session history", () => {
  const landmarks = ["ClipChromeSectionHeader(", "ClipCaptureLaunchCard(", "ClipWorkspaceTargetCard(", "ClipPhotoLibraryUploadSection(", "ClipUnifiedHistoryView("];
  const positions = landmarks.map((landmark) => home.indexOf(landmark));
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
  assert.doesNotMatch(source, /TabView\(|\.tabItem|ClipPhotoBatchesSection|private var photoBatches/);
  assert.match(home, /ScannerHomeControls\([\s\S]*onScan: startCapture,[\s\S]*onConnections: showConnections,[\s\S]*onSettings:/);
  assert.match(home, /ScannerHomeControls\.reservedSpace/);
  assert.match(home, /\.overlay\(alignment: \.bottom\)[\s\S]*GeometryReader \{ proxy in[\s\S]*\.offset\(y: proxy\.safeAreaInsets\.bottom\)/);
});

test("Clip starts offline and resumes the selected session", () => {
  const launch = section("    private func startCapture()", "    private var connectionSummary:");
  assert.doesNotMatch(launch, /guard|isConnected|onScanQRCode/);
  assert.match(launch, /clearOcrReview\(\)[\s\S]*activeCaptureMode = \.ocr[\s\S]*beginCaptureSession\(\)[\s\S]*isCaptureSessionPresented = true/);
  assert.match(home, /onChange\(of: requestedSessionBatchId\)[\s\S]*resumeCaptureSession\(batchId: batchId\)[\s\S]*requestedSessionBatchId = nil/);
  assert.match(home, /store\.endCaptureSession\(id: captureSessionBatchId\)/);
  assert.match(home, /ClipCaptureSessionView\([\s\S]*activeMode: \$store\.activeCaptureMode/);
  assert.match(source, /isCaptureEnabled: !isCapturingPhoto && !isRecognizingText && !store\.isDictationBusy/);
  assert.match(source, /isModeSelectionEnabled: !store\.isDictating && !store\.isDictationBusy/);
  assert.doesNotMatch(source, /isCaptureEnabled: isConnected|isModeSelectionEnabled: isConnected/);
});

test("Clip history reuses bounded square previews, gallery, and delete actions", () => {
  assert.match(history, /ClipPhotoBatchCard\(/);
  assert.match(history, /store\.removeSession\(batchId: id\)/);
  assert.match(history, /onDeletePhoto: \{ store\.removePhoto\(id: \$0\.id\) \}/);
  assert.match(history, /onDeleteBatch: \{ store\.removePhotos\(batchId: id\) \}/);
  assert.match(history, /\.sheet\(item: \$previewedPhoto\)/);
  assert.match(source, /Array\(batch\.photos\.suffix\(4\)\)/);
  assert.match(source, /ClipPhotoBatchGallery\(batch: batch, onDelete: onDeletePhoto\)/);
  assert.match(section("private struct ClipPhotoThumbnail:", "private struct ClipPhotoBatchGallery:"), /\.aspectRatio\(1, contentMode: \.fit\)/);
});

test("Clip connection choices retain guest QR pairing and expose save-only destination", () => {
  assert.match(home, /title: store\.isConnected \? store\.typingTargetLabel/);
  assert.match(home, /selectedWorkspaceComputerId == nil \{ return "iphone" \}/);
  assert.match(home, /selectedWorkspaceComputer == nil \{ return "desktopcomputer\.trianglebadge\.exclamationmark" \}/);
  assert.match(source, /title: "This iPhone",[\s\S]*deviceId: nil/);
  assert.match(source, /Section\("Workspace Computers"\)/);
  assert.match(source, /Section\("Offline"\)/);
  assert.match(source, /Label\("Workspace connection", systemImage: "qrcode.viewfinder"\)/);
  assert.match(source, /Label\("Scan QR", systemImage: "qrcode.viewfinder"\)/);
  assert.match(home, /onDismiss: \{[\s\S]*if opensConnectionAfterTargetPicker[\s\S]*onScanQRCode\(\)/);
  const settings = section("private struct ClipSettingsSheet:", "private struct ClipWorkspaceTargetCard:");
  assert.match(settings, /Guest workspace session/);
  assert.match(settings, /UIApplication\.openSettingsURLString/);
  assert.doesNotMatch(settings, /Clerk|SignIn|SettingsView\(/);
});

test("Clip pairing choices offer QR and validated manual links with retry and progress retained", () => {
  const choices = section("private struct ClipConnectChoicesView:", "private struct ClipConnectionProgressView:");
  assert.match(choices, /List \{[\s\S]*Section\("Guest workspace"\)/);
  assert.match(choices, /TextField\("Paste workspace pairing URL", text: \$pairingURL\)/);
  assert.match(choices, /store\.pairFromScannedValue\(value\)/);
  assert.match(choices, /\.disabled\(pairingURL\.trimmingCharacters\(in: \.whitespacesAndNewlines\)\.isEmpty\)/);
  assert.match(choices, /manualPairingError = "Use a Volt workspace pairing URL/);
  assert.match(choices, /store\.isConnected \? "Type to Computer" : "Connect Workspace"/);
  assert.match(source, /ClipConnectionProgressView\(/);
  assert.match(source, /ClipPairingFailureView\(store: store, onScanQRCode: onScanQRCode\)/);
});
