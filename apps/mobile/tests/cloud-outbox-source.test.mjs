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
const contractsSource = read("../ios/Volt/Models/CloudAPIContracts.swift");
const configurationSource = read("../ios/Volt/App/AppConfiguration.swift");
const xcodeProjectSource = read("../ios/Volt.xcodeproj/project.pbxproj");
const packageResolvedSource = read("../ios/Volt.xcworkspace/xcshareddata/swiftpm/Package.resolved");
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
const captureModeCardsSource = read("../ios/Volt/Views/CaptureModeCards.swift");

test("full app opens capture without pairing, dictation, or a WebRTC target", () => {
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

test("device credentials are stored in the keychain and revoked deterministically", () => {
  assert.match(credentialSource, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
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
  assert.match(captureModeCardsSource, /No computers are online\. Capture still works and syncs to Volt\./);
});

test("queued cursor deliveries are tracked and resolved via a live Convex subscription", () => {
  assert.match(contractsSource, /struct CursorDeliveryStatus\b/);
  assert.match(contractsSource, /var isTerminal: Bool \{ state == "delivered" \|\| state == "failed" \}/);

  assert.match(workspaceSource, /private var inFlightDeliveries: \[String: InFlightDelivery\] = \[:\]/);
  assert.match(workspaceSource, /private struct InFlightDelivery: Equatable, Sendable \{[\s\S]*?let resultId: UUID[\s\S]*?let giveUpAt: Date/);
  assert.match(workspaceSource, /func trackCursorDelivery\(deliveryId: String, resultId: UUID\)/);
  assert.match(workspaceSource, /giveUpAt: Date\.now\.addingTimeInterval\(Self\.deliveryGiveUpInterval\)/);

  // Delivery status now arrives over a live Convex subscription, not HTTP polling.
  assert.match(workspaceSource, /client\.subscribe\(\s*to: "cloudWorkspace:cursorDeliveryStatus",/);
  assert.match(workspaceSource, /"deviceId": credential\.deviceId,\s*"deviceSecret": credential\.value,\s*"deliveryIds": encodedDeliveryIds,/);
  assert.match(workspaceSource, /yielding: CursorDeliveryStatusResponse\.self/);
  assert.doesNotMatch(workspaceSource, /func pollCursorDeliveryStatuses/);
  assert.doesNotMatch(workspaceSource, /api\.cursorDeliveryStatus\(/);
  assert.doesNotMatch(workspaceSource, /isPollingDeliveries/);

  assert.match(workspaceSource, /for status in response\.statuses where status\.isTerminal/);
  assert.match(workspaceSource, /inFlightDeliveries\.removeValue\(forKey: status\.deliveryId\)/);

  // F3: per-delivery give-up deadline pruning resolves lingering ids as expired.
  assert.match(workspaceSource, /\.filter \{ \$0\.value\.giveUpAt <= now \}\s*\.map\(\\\.key\)/);
  assert.match(workspaceSource, /errorCode: "expired"/);
  // F5: the client caps each subscription request to the server's 100-id slice.
  assert.match(workspaceSource, /Array\(inFlightDeliveries\.keys\.sorted\(\)\.prefix\(Self\.deliveryStatusBatchLimit\)\)/);
  // F2: sign-out/revocation buffers .saved resolutions until a handler is attached.
  assert.match(workspaceSource, /private var bufferedDeliveryResolutions: \[CursorDeliveryResolution\] = \[\]/);
  assert.match(workspaceSource, /func setDeliveryResolutionHandler\(_ handler: @escaping \(CursorDeliveryResolution\) -> Void\)/);
  assert.match(workspaceSource, /private func deliverBufferedResolutions\(\)/);
  assert.match(workspaceSource, /private func bufferClearedDeliveryTracking\(\)/);
  const revokeLocal = workspaceSource.match(/func revokeLocalCredential\(\)[\s\S]*?\n    \}/)?.[0] ?? "";
  assert.match(revokeLocal, /bufferClearedDeliveryTracking\(\)/);
  const pauseSignOut = workspaceSource.match(/private func pauseForSignOut\(\)[\s\S]*?\n    \}/)?.[0] ?? "";
  assert.match(pauseSignOut, /bufferClearedDeliveryTracking\(\)/);

  // Subscriptions start/stop with app foreground state instead of a poll loop.
  assert.match(workspaceSource, /func setSubscriptionsActive\(_ isActive: Bool\)/);
  assert.match(rootSource, /store\.cloudWorkspace\.setSubscriptionsActive\(scenePhase == \.active\)/);
  assert.doesNotMatch(rootSource, /refreshDeliveryStatuses/);
  assert.doesNotMatch(scannerViewSource, /refreshDeliveryStatuses/);

  const queueInsertion = captureSource.match(/private func queueCursorInsertion[\s\S]*?^    \}/m)?.[0] ?? "";
  assert.match(queueInsertion, /cloudWorkspace\.trackCursorDelivery\(deliveryId: deliveryId, resultId: result\.id\)/);
  assert.doesNotMatch(captureSource, /func refreshDeliveryStatuses\(\) async/);
  assert.match(captureSource, /func applyDeliveryResolution\(_ resolution: CursorDeliveryResolution\)/);
  assert.match(scannerSource, /cloudWorkspace\.setDeliveryResolutionHandler \{ \[weak self\] resolution in/);
  assert.match(captureSource, /case "expired":/);
  assert.match(captureSource, /case "no-editable-field":/);
  assert.match(captureSource, /case "target-rebound":/);
});

test("convex-swift is pinned safely and the socket URL cannot diverge from the site URL", () => {
  // Pre-0.8.1 crashes when cancelling an already-terminated subscription —
  // exactly the scenePhase background/foreground lifecycle above.
  assert.match(xcodeProjectSource, /convex-swift[\s\S]*?minimumVersion = 0\.8\.1;/);
  assert.match(packageResolvedSource, /"identity" : "convex-swift"[\s\S]*?"version" : "0\.8\.1"/);

  assert.match(configurationSource, /static var convexCloudURL: URL \{/);
  assert.match(configurationSource, /configuredString\(for: "VoltConvexCloudURL"\)/);
  assert.match(
    configurationSource,
    /configuredString\(for: "VoltConvexSiteURL"\)[\s\S]*?replacingOccurrences\(of: "\.convex\.site", with: "\.convex\.cloud"\)/,
  );
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
