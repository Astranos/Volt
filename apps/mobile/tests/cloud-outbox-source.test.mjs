import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const appSource = read("../ios/Volt/App/VoltApp.swift");
const rootSource = read("../ios/Volt/Views/RootView.swift");
const scannerSource = read("../ios/Volt/Services/ScannerStore.swift");
const captureSource = read("../ios/Volt/Services/ScannerStoreCaptureActions.swift");
const dictationSource = read("../ios/Volt/Services/ScannerStoreDictation.swift");
const outboxSource = read("../ios/Volt/Services/DurableCaptureOutbox.swift");
const workspaceSource = read("../ios/Volt/Services/CloudWorkspaceStore.swift");
const credentialSource = read("../ios/Volt/Services/DeviceCredentialStore.swift");
const enrollmentSource = read("../ios/Volt/Services/EnrollmentURLParser.swift");
const contractsSource = read("../ios/Volt/Models/CloudAPIContracts.swift");
const pairingSource = read("../ios/Volt/Services/PairingURLParser.swift");
const clipStoreSource = read("../ios/VoltClip/Services/ClipScannerStore.swift");
const clipGuestCloudSource = read("../ios/VoltClip/Services/AppClipGuestCloudClient.swift");

test("full app opens capture without Clerk or a WebRTC target", () => {
  assert.match(appSource, /RootView\(showsAccountSettings: false\)\s*\.environment\(scannerStore\)/);
  assert.doesNotMatch(appSource, /else \{\s*ClerkConfigurationRequiredView\(\)/);
  assert.doesNotMatch(rootSource, /guard hasSeenWelcome/);
  assert.doesNotMatch(captureSource.match(/func uploadPhotos[\s\S]*?func capturePhoto/)?.[0] ?? "", /guard connectionStatus\.isConnected/);
  assert.doesNotMatch(dictationSource.match(/func startDictation[\s\S]*?func finishDictation/)?.[0] ?? "", /guard connectionStatus\.isConnected/);
});

test("accepted captures commit to durable outbox before UI and optional WebRTC", () => {
  const saveBarcode = captureSource.match(/func saveBarcodeIfNeeded\(\)[\s\S]*?func pairScannedBarcodeIfNeeded/)?.[0] ?? "";
  assert.ok(saveBarcode.indexOf("saveResultLocally(result)") < saveBarcode.indexOf("sendCaptureResult(result"));

  const saveText = captureSource.match(/func sendRecognizedText[\s\S]*?func captureSquarePhoto/)?.[0] ?? "";
  assert.ok(saveText.indexOf("saveResultLocally(result)") < saveText.indexOf("sendCaptureResult(result"));

  const sendPhoto = captureSource.match(/func sendPhoto\([\s\S]*?func sendRetryablePhotos/)?.[0] ?? "";
  const persistIndex = sendPhoto.indexOf("try cloudWorkspace.persist");
  const insertIndex = sendPhoto.indexOf("results.insert(cloudResult");
  const connectionIndex = sendPhoto.indexOf("guard connectionStatus.isConnected");
  assert.ok(persistIndex >= 0 && persistIndex < insertIndex && insertIndex < connectionIndex);

  const commitDictation = dictationSource.match(/func commitDictation[\s\S]*?func beginDictationSession/)?.[0] ?? "";
  assert.ok(commitDictation.indexOf("saveResultLocally(result)") < commitDictation.indexOf("sendDictation(text"));
  assert.match(scannerSource, /self\.results = cloudWorkspace\.restoredResults/);
  assert.match(outboxSource, /write\(to: manifestURL, options: \[\.atomic, \.completeFileProtection\]\)/);
});

test("cloud photos use presigned direct PUT and batch idempotency contracts", () => {
  assert.match(contractsSource, /struct PutCloudBatchRequest/);
  assert.match(contractsSource, /let deviceSecret: String/);
  assert.match(contractsSource, /let results: \[CloudResultInput\]/);
  assert.match(contractsSource, /let clientCreatedAt: Double/);
  assert.match(contractsSource, /let byteCount: Int/);
  assert.match(workspaceSource, /api\.putBatch\(/);
  assert.match(workspaceSource, /api\.createPhotoUploadURL\(/);
  assert.match(workspaceSource, /api\.uploadPhoto\(photoData, using: upload\)/);
  assert.match(workspaceSource, /api\.markBatchReady\(/);
  assert.match(workspaceSource, /clientCreatedAt: createdAt\.timeIntervalSince1970 \* 1_000/);
});

test("one-time enrollment stores only an opaque revocable device secret in Keychain", () => {
  assert.match(enrollmentSource, /!looksLikeJWT\(token\)/);
  assert.match(contractsSource, /let enrollmentCode: String/);
  assert.match(contractsSource, /let deviceSecret: String/);
  assert.match(credentialSource, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.match(workspaceSource, /DeviceCredentialStore\.save\(credential\)/);
  assert.match(workspaceSource, /catch MobileCloudError\.credentialRevoked/);
  assert.match(workspaceSource, /revokeLocalCredential\(\)/);
  assert.doesNotMatch(enrollmentSource + credentialSource + contractsSource, /Clerk|JWTTemplate|session token/i);
});

test("App Clip mirrors successful WebRTC captures with an ephemeral QR guest grant", () => {
  assert.match(pairingSource, /guestCloudGrant: query\["guestCloudGrant"\]/);
  assert.match(pairingSource, /guestCloudExpiresAt: query\["guestCloudExpiresAt"\]/);
  assert.match(clipGuestCloudSource, /api\/app-clip\/outbox\/sync/);
  assert.match(clipGuestCloudSource, /api\/app-clip\/photos\/upload-url/);
  assert.match(clipGuestCloudSource, /api\/app-clip\/batches\/finalize/);
  assert.match(clipStoreSource, /mirrorCaptureToCloud\(capture\)/);
  assert.match(clipStoreSource, /mirrorPhotoToCloud\(photo, filename: resolvedFilename\)/);
  assert.match(clipStoreSource, /mirrorFinalDictationToCloud\(text\)/);
  assert.ok(clipStoreSource.indexOf("transport.sendCaptureResult") < clipStoreSource.indexOf("mirrorCaptureToCloud(capture)"));
  assert.doesNotMatch(clipGuestCloudSource, /Keychain|UserDefaults|Clerk|StoreKit/);
});
