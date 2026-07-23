import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const appSource = read("../ios/Volt/App/VoltApp.swift");
const rootSource = read("../ios/Volt/Views/RootView.swift");
const scannerSource = read("../ios/Volt/Services/ScannerStore.swift");
const captureSource = read("../ios/Volt/Services/ScannerStoreCaptureActions.swift");
const outboxSource = read("../ios/Volt/Services/DurableCaptureOutbox.swift");
const workspaceSource = read("../ios/Volt/Services/CloudWorkspaceStore.swift");
const credentialSource = read("../ios/Volt/Services/DeviceCredentialStore.swift");
const enrollmentSource = read("../ios/Volt/Services/EnrollmentURLParser.swift");
const contractsSource = read("../ios/Volt/Models/CloudAPIContracts.swift");
const cloudCredentialSource = read("../ios/Volt/Models/CloudDeviceCredential.swift");
const cloudRecordSource = read("../ios/Volt/Models/CloudCaptureRecord.swift");
const cloudAPISource = read("../ios/Volt/Services/MobileCloudAPIClient.swift");
const rootSceneSource = read("../ios/Volt/Views/VoltRootScene.swift");
const scannerViewSource = read("../ios/Volt/Views/ScannerView.swift");
const captureViewSource = read("../ios/Volt/Views/CaptureSessionView.swift");
const uploadViewSource = read("../ios/Volt/Views/ResultsView.swift");
const pairingSource = read("../ios/Volt/Services/PairingURLParser.swift");
const clipStoreSource = read("../ios/VoltClip/Services/ClipScannerStore.swift");
const clipGuestCloudSource = read("../ios/VoltClip/Services/AppClipGuestCloudClient.swift");

test("full app opens capture without Clerk, pairing, dictation, or a WebRTC target", () => {
  assert.match(appSource, /RootView\(showsAccountSettings: false\)\s*\.environment\(scannerStore\)/);
  assert.doesNotMatch(appSource, /else \{\s*ClerkConfigurationRequiredView\(\)/);
  assert.doesNotMatch(appSource, /PairingURLParser/);
  assert.doesNotMatch(rootSource, /DictationView|PairingSessionsView|AppSection\.dictation/);
  assert.doesNotMatch(scannerSource, /ScannerWebRTCConnection|connectionStatus|peerTarget|DictationModel/);
  assert.doesNotMatch(captureSource, /guard connectionStatus\.isConnected|sendCaptureResultOverWebRTC|sendDictation/);
});

test("accepted captures commit to durable outbox before UI and optional cloud delivery", () => {
  const saveBarcode = captureSource.match(/func saveBarcodeIfNeeded\(\)[\s\S]*?func capture\(\)/)?.[0] ?? "";
  assert.ok(saveBarcode.indexOf("saveResultLocally(result)") < saveBarcode.indexOf("sendCaptureResult(result"));

  const saveText = captureSource.match(/func sendRecognizedText[\s\S]*?func captureSquarePhoto/)?.[0] ?? "";
  assert.ok(saveText.indexOf("saveResultLocally(result)") < saveText.indexOf("sendCaptureResult(result"));

  const sendPhoto = captureSource.match(/func sendPhoto\([\s\S]*?var initialDeliveryState/)?.[0] ?? "";
  const persistIndex = sendPhoto.indexOf("try cloudWorkspace.persist");
  const insertIndex = sendPhoto.indexOf("results.insert(cloudResult");
  assert.ok(persistIndex >= 0 && persistIndex < insertIndex);
  assert.doesNotMatch(sendPhoto, /connectionStatus|photoRetryQueue|connection\.sendPhoto/);

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

test("legacy one-time enrollment remains available alongside account bootstrap", () => {
  assert.match(enrollmentSource, /!looksLikeJWT\(token\)/);
  assert.match(contractsSource, /let enrollmentCode: String/);
  assert.match(contractsSource, /let deviceSecret: String/);
  assert.match(credentialSource, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.match(workspaceSource, /api\.exchangeEnrollment/);
  assert.match(workspaceSource, /ownerClerkUserId: nil/);
  assert.match(workspaceSource, /catch MobileCloudError\.credentialRevoked/);
  assert.match(workspaceSource, /revokeLocalCredential\(\)/);
});

test("signed-in installed app bootstraps a Clerk-owned stable installation credential", () => {
  assert.match(cloudAPISource, /api\/mobile\/devices\/bootstrap/);
  assert.ok(cloudAPISource.includes('setValue("Bearer \\(bearerToken)", forHTTPHeaderField: "Authorization")'));
  assert.match(workspaceSource, /static let installationIdKey = "volt\.mobile\.installation-id\.v1"/);
  assert.match(workspaceSource, /UserDefaults\.standard\.set\(value, forKey: installationIdKey\)/);
  assert.match(workspaceSource, /credential\?\.clerkUserId == clerkUserId \|\| credential\?\.clerkUserId == nil/);
  assert.match(workspaceSource, /existingDeviceId: existingDeviceId/);
  assert.match(workspaceSource, /ownerClerkUserId: response\.clerkUserId/);
  assert.match(rootSceneSource, /cloudWorkspace\.bootstrapIfNeeded\(using: clerk\)/);
  assert.match(workspaceSource, /template: AppConfiguration\.clerkJWTTemplate/);
  assert.match(workspaceSource, /skipCache: true/);
});

test("outbox ownership prevents silent cross-account upload and requires a decision", () => {
  assert.match(cloudCredentialSource, /let ownerClerkUserId: String\?/);
  assert.match(cloudRecordSource, /var ownerClerkUserId: String\?/);
  assert.match(cloudRecordSource, /var workspaceId: String\?/);
  assert.match(cloudRecordSource, /case held/);
  assert.match(outboxSource, /record\.ownerClerkUserId == ownerClerkUserId/);
  assert.match(outboxSource, /record\.state != \.held/);
  assert.match(outboxSource, /func reconcileOwnership/);
  assert.match(outboxSource, /func retain\(ids:/);
  assert.match(outboxSource, /record\.retainedLocally != true/);
  assert.match(outboxSource, /func attach\(ids:/);
  assert.match(workspaceSource, /pauseForSignOut\(\)/);
  assert.match(rootSource, /AccountSwitchCaptureDecisionView/);
  assert.match(rootSource, /Attach to Current Account/);
  assert.match(rootSource, /Export Captures/);
  assert.match(rootSource, /UIActivityViewController\(activityItems: items/);
  assert.match(rootSource, /Retain on This iPhone/);
  assert.match(rootSource, /Delete Pending Captures/);
});

test("outbox sync requests during a drain schedule an immediate follow-up drain", () => {
  assert.match(workspaceSource, /private var syncRequestedWhileDraining = false/);
  const requestSync = workspaceSource.match(/func requestSync\(\)[\s\S]*?private var activeCredential/)?.[0] ?? "";
  assert.match(
    requestSync,
    /if syncTask != nil \{\s*syncRequestedWhileDraining = true\s*return\s*\}/,
  );
  const drainOutbox = workspaceSource.match(/private func drainOutbox\(\) async[\s\S]*?private func scheduleRetryIfNeeded/)?.[0] ?? "";
  assert.match(
    drainOutbox,
    /syncTask = nil\s*if syncRequestedWhileDraining \|\| hasReadyRecordsForActiveCredential \{\s*syncRequestedWhileDraining = false\s*requestSync\(\)/,
  );
  assert.match(
    drainOutbox,
    /return !outbox\.readyRecords\(ownerClerkUserId: ownerClerkUserId\)\.isEmpty/,
  );
});

test("cloud cursor target and per-result delivery are optional downstream work", () => {
  assert.match(cloudAPISource, /api\/mobile\/computers\/list/);
  assert.match(cloudAPISource, /api\/mobile\/cursor-target/);
  assert.match(cloudAPISource, /api\/mobile\/deliveries\/queue/);
  assert.match(workspaceSource, /filter \{ \$0\.online && \$0\.supportsCursorInsertion \}/);
  assert.match(workspaceSource, /func selectTarget\(deviceId: String\?\)/);
  assert.match(contractsSource, /encodeNil\(forKey: \.cursorTargetDeviceId\)/);
  assert.ok(captureSource.includes('"del-\\(result.id.uuidString.lowercased())"'));
  assert.ok(captureSource.includes('"del-\\(UUID().uuidString.lowercased())"'));
  assert.match(workspaceSource, /if let syncTask \{ await syncTask\.value \}/);
  assert.match(workspaceSource, /state == \.uploaded/);
  assert.match(workspaceSource, /clientCreatedAt: Date\.now\.timeIntervalSince1970 \* 1_000/);
  assert.match(workspaceSource, /for attempt in 0\.\.<3/);
  assert.match(scannerViewSource, /"No computer"/);
});

test("queued cursor deliveries are tracked and polled for terminal status feedback", () => {
  assert.match(cloudAPISource, /api\/mobile\/deliveries\/status/);
  assert.match(cloudAPISource, /func cursorDeliveryStatus\(_ request: CursorDeliveryStatusRequest\)/);
  assert.match(contractsSource, /struct CursorDeliveryStatusRequest/);
  assert.match(contractsSource, /let deliveryIds: \[String\]/);
  assert.match(contractsSource, /struct CursorDeliveryStatus/);
  assert.match(contractsSource, /var isTerminal: Bool \{ state == "delivered" \|\| state == "failed" \}/);

  assert.match(workspaceSource, /private var inFlightDeliveries: \[String: InFlightDelivery\] = \[:\]/);
  assert.match(workspaceSource, /private struct InFlightDelivery: Equatable, Sendable \{[\s\S]*?let resultId: UUID[\s\S]*?let giveUpAt: Date/);
  assert.match(workspaceSource, /func trackCursorDelivery\(deliveryId: String, resultId: UUID\)/);
  assert.match(workspaceSource, /giveUpAt: Date\.now\.addingTimeInterval\(Self\.deliveryGiveUpInterval\)/);
  assert.match(workspaceSource, /func pollCursorDeliveryStatuses\(\) async -> \[CursorDeliveryResolution\]/);
  assert.match(workspaceSource, /api\.cursorDeliveryStatus\(/);
  assert.match(workspaceSource, /for status in response\.statuses where status\.isTerminal/);
  assert.match(workspaceSource, /inFlightDeliveries\.removeValue\(forKey: status\.deliveryId\)/);

  // F3: per-delivery give-up deadline pruning resolves lingering ids as expired.
  assert.match(workspaceSource, /inFlightDeliveries\.filter\(\{ \$0\.value\.giveUpAt <= now \}\)\.keys/);
  assert.match(workspaceSource, /errorCode: "expired"/);
  // F4: overlapping polls are coalesced behind a MainActor Bool guard.
  assert.match(workspaceSource, /private var isPollingDeliveries = false/);
  assert.match(workspaceSource, /guard !isPollingDeliveries else \{ return resolutions \}/);
  // F5: the client caps each poll to the server's 100-id slice.
  assert.match(workspaceSource, /inFlightDeliveries\.keys\.prefix\(Self\.deliveryStatusBatchLimit\)/);
  // F2: sign-out/revocation buffers .saved resolutions drained before the guard.
  assert.match(workspaceSource, /private var bufferedDeliveryResolutions: \[CursorDeliveryResolution\] = \[\]/);
  assert.match(workspaceSource, /var resolutions = drainBufferedResolutions\(\)/);
  assert.match(workspaceSource, /private func bufferClearedDeliveryTracking\(\)/);
  const revokeLocal = workspaceSource.match(/func revokeLocalCredential\(\)[\s\S]*?\n    \}/)?.[0] ?? "";
  assert.match(revokeLocal, /bufferClearedDeliveryTracking\(\)/);
  const pauseSignOut = workspaceSource.match(/private func pauseForSignOut\(\)[\s\S]*?\n    \}/)?.[0] ?? "";
  assert.match(pauseSignOut, /bufferClearedDeliveryTracking\(\)/);

  const queueInsertion = captureSource.match(/private func queueCursorInsertion[\s\S]*?^    \}/m)?.[0] ?? "";
  assert.match(queueInsertion, /cloudWorkspace\.trackCursorDelivery\(deliveryId: deliveryId, resultId: result\.id\)/);
  assert.match(captureSource, /func refreshDeliveryStatuses\(\) async/);
  assert.match(captureSource, /await cloudWorkspace\.pollCursorDeliveryStatuses\(\)/);
  assert.match(captureSource, /case "expired":/);
  assert.match(captureSource, /case "no-editable-field":/);
  assert.match(captureSource, /case "target-rebound":/);

  assert.match(scannerViewSource, /await store\.refreshDeliveryStatuses\(\)/);
  assert.match(rootSource, /await store\.refreshDeliveryStatuses\(\)/);
});

test("full-app capture and photo selection are not gated on WebRTC", () => {
  assert.match(scannerViewSource, /ScannerBottomActionAccessory\([\s\S]*isEnabled: true/);
  assert.doesNotMatch(scannerViewSource, /guard store\.connectionStatus\.isConnected/);
  assert.match(captureViewSource, /isCaptureEnabled: true/);
  assert.doesNotMatch(captureViewSource, /\.onChange\(of: store\.connectionStatus\)/);
  assert.match(uploadViewSource, /isConnected: true/);
  assert.doesNotMatch(uploadViewSource, /guard store\.connectionStatus\.isConnected/);
  assert.match(uploadViewSource, /while !queuedUploadSelections\.isEmpty/);
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
