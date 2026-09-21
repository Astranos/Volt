import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { scannerProtocolGolden } from "@volt/scanner-protocol/protocol-fixtures";
import {
  scannerStoreSwiftSource,
  captureModeSwiftSource,
  cloudAPIContractsSwiftSource,
  cloudWorkspaceStoreSwiftSource,
  mobileCloudAPIClientSwiftSource,
  scannerStoreCaptureActionsSwiftSource,
  rootViewSwiftSource,
  voltBrandSwiftSource,
  cloudTargetPickerSwiftSource,
  settingsViewSwiftSource,
  scannerViewSwiftSource,
  captureModeCardsSwiftSource,
  captureSessionViewSwiftSource,
  subscriptionActionsSwiftSource,
  sharedCameraSessionControlsSwiftSource,
  sharedScannerTabComponentsSwiftSource,
  uploadViewSwiftSource,
} from "./native-source-fixtures.mjs";

test("signed-in AI product scanning is metered, request-id scoped, and uses existing result delivery", () => {
  assert.match(captureModeSwiftSource, /enum ProductScanMode: String, CaseIterable, Identifiable, Codable, Sendable/);
  assert.match(captureModeSwiftSource, /case upc\s*case name/);
  assert.match(captureModeSwiftSource, /case \.upc:[\s\S]*"barcode"[\s\S]*case \.name:[\s\S]*"textformat\.characters"/);
  assert.match(scannerStoreSwiftSource, /var isProductScannerActive = false[\s\S]*var productScanMode: ProductScanMode = \.upc[\s\S]*var isProductScanBusy = false/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /func captureProduct\(using clerk: Clerk\) async[\s\S]*guard !isProductScanQuotaExhausted[\s\S]*let requestId = UUID\(\)[\s\S]*capturePhoto\(matchingDeviceOrientation: true\)[\s\S]*boundedJPEGData\(maxLongEdge: 1600, maxBytes: 1_500_000\)[\s\S]*analyzeProductImage\([\s\S]*requestId: requestId,[\s\S]*using: clerk/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /updateProductScanQuota\(response\.quota\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /updateProductScanQuota\(error\.aiQuota\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /case \.upc:[\s\S]*kind: \.barcode,[\s\S]*format: "ai-upc\/\\\(normalized\.format\)"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /case \.name:[\s\S]*kind: \.text,[\s\S]*format: "ai-item-name"/);
  assert.match(cloudWorkspaceStoreSwiftSource, /func analyzeProductImage\([\s\S]*requestId: UUID,[\s\S]*using clerk: Clerk[\s\S]*async throws -> ProductScanResponse/);
  assert.match(cloudWorkspaceStoreSwiftSource, /catch MobileCloudError\.credentialRevoked[\s\S]*revokeLocalCredential\(\)[\s\S]*await bootstrapIfNeeded\(using: clerk\)[\s\S]*requestId: requestId/);
  assert.match(cloudAPIContractsSwiftSource, /struct ProductScanResponse: Decodable, Sendable[\s\S]*let value: String\?[\s\S]*let quota: AIScannerQuota\?/);
  assert.match(mobileCloudAPIClientSwiftSource, /api\/mobile\/ai\/analyze[\s\S]*URLQueryItem\(name: "mode", value: mode\.rawValue\)/);
  assert.match(mobileCloudAPIClientSwiftSource, /setValue\("image\/jpeg", forHTTPHeaderField: "Content-Type"\)/);
  assert.match(mobileCloudAPIClientSwiftSource, /X-Volt-Device-Id[\s\S]*X-Volt-Device-Secret/);
  assert.match(mobileCloudAPIClientSwiftSource, /X-Volt-AI-Request-Id/);
  assert.match(mobileCloudAPIClientSwiftSource, /statusCode == 429[\s\S]*quota-exhausted[\s\S]*aiQuotaExhausted[\s\S]*rate-limited[\s\S]*aiRateLimited/);
  assert.match(mobileCloudAPIClientSwiftSource, /case \.aiQuotaExhausted[\s\S]*Your AI scan limit is used up/);
  assert.match(mobileCloudAPIClientSwiftSource, /case \.aiRateLimited[\s\S]*AI scanning is busy right now/);
  assert.match(mobileCloudAPIClientSwiftSource, /case \.cloudWorkspaceRequired[\s\S]*Volt Pro cloud workspace access/);
  assert.doesNotMatch(mobileCloudAPIClientSwiftSource, /paidSubscriptionRequired|paid Volt subscription/);
  assert.match(sharedCameraSessionControlsSwiftSource, /var showsProductScanner = false[\s\S]*var productScanMode: ProductScanMode = \.upc/);
  assert.match(sharedCameraSessionControlsSwiftSource, /if isProductScannerSelected, let onToggleProductScanMode[\s\S]*productScanToolSlot/);
  assert.match(sharedCameraSessionControlsSwiftSource, /systemImage: productScanMode\.systemImage[\s\S]*SessionIconButton/);
  assert.match(sharedCameraSessionControlsSwiftSource, /modeButton\("Audio", mode: \.dictation\)[\s\S]*productModeButton/);
  assert.match(captureSessionViewSwiftSource, /showsProductScanner: true[\s\S]*isProductScannerSelected: store\.isProductScannerActive[\s\S]*productScannerAvailable: !store\.isProductScanQuotaExhausted/);
  assert.match(captureSessionViewSwiftSource, /productScanQuotaText: store\.productScanQuotaText/);
  assert.match(captureSessionViewSwiftSource, /isRecognizingText: store\.isRecognizingText \|\| store\.isDictationBusy \|\| store\.isProductScanBusy/);
  assert.match(captureSessionViewSwiftSource, /ScannerCameraLayer\(gridVisible: gridVisible && !store\.isProductScannerActive\)/);
  assert.match(captureSessionViewSwiftSource, /if store\.isProductScannerActive \{[\s\S]*if store\.isProductScanQuotaExhausted \{\s*isSubscriptionPaywallPresented = true[\s\S]*await store\.captureProduct\(using: clerk\)/);
  assert.doesNotMatch(captureSessionViewSwiftSource, /hasPaidProductScannerAccess|accessStore\.status\?\.access == \.subscription/);
  assert.match(sharedCameraSessionControlsSwiftSource, /struct CameraSessionTopStatus: View[\s\S]*if let productScanQuotaText[\s\S]*Text\(productScanQuotaText\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /else if let productScanOutput[\s\S]*"UPC found"[\s\S]*Text\(productScanOutput\.value\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /ProductScanProgressText\(mode: productScanMode, isBusy: isProductScanBusy\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /"Identifying game", "Searching game catalog", "Verifying UPC"/);
  assert.match(scannerStoreSwiftSource, /var isProductScanQuotaExhausted: Bool \{\s*productScanQuota\?\.remaining == 0/);
  assert.match(scannerStoreSwiftSource, /Free AI scans remaining:/);
  assert.match(scannerStoreSwiftSource, /resetsAt\.formatted\(date: \.abbreviated, time: \.shortened\)/);
  assert.match(cloudWorkspaceStoreSwiftSource, /func setCloudWorkspaceEnabled\(_ isEnabled: Bool\)/);
  assert.match(cloudWorkspaceStoreSwiftSource, /func requestSync\(\) \{\s*guard cloudWorkspaceEnabled, activeCredential != nil/);
});

test("full app dictation uses Speech APIs and streams live drafts to the selected computer", () => {
  const speechSource = readFileSync(
    new URL("../ios/Volt/Services/SpeechDictationService.swift", import.meta.url),
    "utf8"
  );
  const dictationStoreSource = readFileSync(
    new URL("../ios/Volt/Services/ScannerStoreDictation.swift", import.meta.url),
    "utf8"
  );
  const dictationViewSource = readFileSync(
    new URL("../ios/Volt/Views/DictationView.swift", import.meta.url),
    "utf8"
  );
  assert.match(speechSource, /SpeechAnalyzer|DictationTranscriber|AVAudioEngine/);
  assert.match(speechSource, /reportingOptions: \[\.volatileResults, \.frequentFinalization\]/);
  assert.match(speechSource, /analyzer\.analyzeSequence\(inputStream\)/);
  assert.match(speechSource, /analyzer\.finalizeAndFinishThroughEndOfInput\(\)/);
  assert.match(speechSource, /AVAudioApplication\.requestRecordPermission/);
  assert.doesNotMatch(speechSource, /SFSpeechRecognizer|SFSpeechAudioBufferRecognitionRequest|SFSpeechRecognitionTask/);
  assert.doesNotMatch(speechSource, /WebRTC|WKWebView|UITextInput|keyboard/);
  assert.match(dictationStoreSource, /func startLiveDictation\(\) async/);
  assert.match(dictationStoreSource, /func stopLiveDictation\(\) async/);
  assert.match(dictationStoreSource, /updateDictationDraft\(draftId:/);
  assert.match(dictationStoreSource, /clearDictationDraft\(draftId:/);
  assert.match(dictationStoreSource, /kind: \.dictation/);
  assert.match(dictationStoreSource, /format: "dictation"/);
  assert.match(dictationStoreSource, /id: sessionId/);
  assert.match(dictationViewSource, /DictationView|Start Dictation|Stop Dictation|Live Transcript/);
  assert.match(dictationViewSource, /CloudTargetButton|CloudTargetPickerSheet/);

  // The audio session is activated before `inputNode` is ever touched, and the
  // resulting format is validated: a 0 Hz / 0 channel format passed to installTap
  // traps inside AVAudioEngine and takes the whole app down.
  assert.ok(
    speechSource.indexOf("try activateAudioSession()") <
      speechSource.indexOf("audioEngine.inputNode"),
    "audio session must be activated before the input node is created"
  );
  assert.match(
    speechSource,
    /guard sourceFormat\.sampleRate > 0, sourceFormat\.channelCount > 0 else \{[\s\S]*?throw SpeechDictationError\.microphoneUnavailable/
  );
  // `.duckOthers` is illegal on `.record` and makes setCategory throw, so dictation
  // could never start.
  assert.doesNotMatch(speechSource, /setCategory\([^)]*\.record[^)]*duckOthers/);
  // A tap buffer forwarded without a copy is reused by the engine on the next
  // callback, so the analyzer would read freed audio.
  assert.match(speechSource, /buffer\.deepCopy\(\)/);
  // `.inputRanDry` is the normal terminal status for a one-buffer pull conversion;
  // rejecting it dropped every converted frame.
  assert.doesNotMatch(speechSource, /guard status == \.haveData/);
  // AVAudioEngine runs its tap callback on a real-time audio thread. Creating that
  // closure inside the MainActor service makes Swift 6 enforce the wrong executor
  // at runtime and crash before the first buffer can be processed.
  assert.match(speechSource, /private nonisolated static func makeAudioTapHandler\(/);
  assert.match(speechSource, /block: tapHandler/);

  // Start and stop both need an unmistakable signal, because people speak the moment
  // they tap and stop on the tail of the last word.
  assert.match(speechSource, /case preparing[\s\S]*case listening[\s\S]*case finishing/);
  assert.match(speechSource, /tailCaptureDuration/);
  assert.match(speechSource, /guard phase == \.idle else \{ return \}/);
  assert.match(dictationStoreSource, /noteDictationOutcome\(\.saved\)/);
  assert.match(dictationViewSource, /sensoryFeedback/);
  assert.match(dictationViewSource, /new == \.listening/);
  assert.match(captureSessionViewSwiftSource, /store\.activeMode == \.dictation/);
  assert.match(
    readFileSync(new URL("../ios/Volt/Services/CloudWorkspaceStore.swift", import.meta.url), "utf8"),
    /func updateDictationDraft\(draftId:/
  );
  assert.match(
    readFileSync(new URL("../ios/Volt/Services/CloudWorkspaceStore.swift", import.meta.url), "utf8"),
    /client\.mutation\(\s*"cloudWorkspace:updateDictationDraft"/
  );
  assert.doesNotMatch(
    readFileSync(new URL("../ios/Volt/Services/MobileCloudAPIClient.swift", import.meta.url), "utf8"),
    /dictation-drafts/
  );
});

test("native upload batches expose clear progress while photos are preparing and uploading", () => {
  assert.match(sharedScannerTabComponentsSwiftSource, /struct PhotoUploadProgress: Identifiable, Equatable/);
  assert.match(scannerStoreSwiftSource, /var photoUploadProgress: PhotoUploadProgress\?/);
  assert.match(sharedScannerTabComponentsSwiftSource, /var remainingCount: Int/);
  assert.match(sharedScannerTabComponentsSwiftSource, /"Uploading \\\(min\(finishedCount \+ 1, total\)\) of \\\(total\)"/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /photoUploadProgress = PhotoUploadProgress\(/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /updatePhotoUploadProgress\(batchId: batch, prepared: index \+ 1, phase: \.uploading\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /finishPhotoUploadItem\(batchId: batch, resultId: photoResult\.id\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /finishPhotoUploadBatch\(batchId: batch\)/);
  assert.match(uploadViewSwiftSource, /PhotoPreparationProgressSummary\(\s*prepared: selectedUploadPrepared,\s*total: selectedUploadTotal\s*\)/);
  assert.match(uploadViewSwiftSource, /PhotoUploadProgressSummary\(progress: progress\)/);
  assert.match(sharedScannerTabComponentsSwiftSource, /ProgressView\(value: progress\.fractionCompleted\)/);
  assert.match(uploadViewSwiftSource, /"Reading \\\(selectedUploadReadCount\) of \\\(selectedUploadTotal\) selected photos"/);
  assert.match(sharedScannerTabComponentsSwiftSource, /struct PhotoPreparationProgressSummary: View/);
  assert.match(sharedScannerTabComponentsSwiftSource, /struct PhotoUploadProgressSummary: View/);
  assert.match(captureModeCardsSwiftSource, /GeometryReader \{ proxy in/);
  assert.match(captureModeCardsSwiftSource, /\.frame\(width: proxy\.size\.width, height: proxy\.size\.height\)/);
  assert.match(captureModeCardsSwiftSource, /LazyVGrid\(columns: columns/);
  assert.match(captureModeCardsSwiftSource, /private var visibleResults: \[ScanResult\] \{\s*Array\(batch\.results\.suffix\(4\)\)/);
  assert.match(captureModeCardsSwiftSource, /NavigationLink \{\s*PhotoBatchGallery\(batch: batch, onDelete: onDelete\)/);
  assert.match(captureModeCardsSwiftSource, /private struct PhotoBatchGallery: View \{\s*let batch: PhotoBatch[\s\S]*ForEach\(batch\.results\)/);
  assert.doesNotMatch(captureModeCardsSwiftSource, /_results = State\(initialValue: batch\.results\)/);
  assert.doesNotMatch(captureModeCardsSwiftSource, /paperplane\.circle\.fill/);
  assert.match(uploadViewSwiftSource, /"\\\(progress\.title\)\. \\\(progress\.detail\)\."/);
  assert.match(captureModeCardsSwiftSource, /let action = source == \.upload \? "uploaded" : "captured"/);
  assert.match(readFileSync(new URL("../ios/Volt/Views/SharedScannerTabComponents.swift", import.meta.url), "utf8"), /var isUploading = false/);
});

test("native upload picker accepts and queues more photos while a batch is active", () => {
  assert.match(uploadViewSwiftSource, /@State private var queuedUploadSelections: \[\[PhotosPickerItem\]\] = \[\]/);
  assert.match(uploadViewSwiftSource, /private func enqueueUploadSelection\(_ items: \[PhotosPickerItem\]\)/);
  assert.match(uploadViewSwiftSource, /while !queuedUploadSelections\.isEmpty/);
  assert.doesNotMatch(uploadViewSwiftSource, /guard store\.connectionStatus\.isConnected/);
  assert.doesNotMatch(uploadViewSwiftSource, /\.onChange\(of: store\.connectionStatus\)/);
  assert.match(uploadViewSwiftSource, /selectedItems = \[\][\s\S]*enqueueUploadSelection\(newItems\)/);
  assert.match(uploadViewSwiftSource, /else if let progress = activeUploadProgress/);
  assert.doesNotMatch(uploadViewSwiftSource, /defer \{[\s\S]*isPreparingUploads = false/);
  assert.match(sharedScannerTabComponentsSwiftSource, /let isPickerEnabled = isConnected/);
  assert.match(sharedScannerTabComponentsSwiftSource, /return "Add More Photos"/);
});

test("full app main Scan surface exposes the photo-library upload control", () => {
  const scanStart = scannerViewSwiftSource.indexOf("struct UnifiedCaptureHomeView: View");
  const scanEnd = scannerViewSwiftSource.indexOf("private struct UnifiedCaptureLaunchCard", scanStart);
  const scanSource = scannerViewSwiftSource.slice(scanStart, scanEnd);

  assert.ok(scanStart > -1);
  assert.ok(scanEnd > scanStart);
  assert.match(scanSource, /PhotoLibraryUploadSection\(\)/);
});

test("full app presents Volt, unified History, and Settings roots", () => {
  const enumStart = rootViewSwiftSource.indexOf("enum AppSection");
  const enumEnd = rootViewSwiftSource.indexOf("}", enumStart);
  const enumSource = rootViewSwiftSource.slice(enumStart, enumEnd);

  assert.doesNotMatch(rootViewSwiftSource, /TabView\(|\.tabItem/);
  assert.match(rootViewSwiftSource, /@State private var presentedSheet: RootPresentedSheet\?/);
  assert.match(rootViewSwiftSource, /@ViewBuilder\s*private var selectedContent: some View/);
  assert.match(rootViewSwiftSource, /case \.text, \.barcode, \.dictation:[\s\S]*UnifiedCaptureHomeView\(\)/);
  assert.match(rootViewSwiftSource, /case \.photos:[\s\S]*CaptureHistoryView\(\)/);
  assert.match(rootViewSwiftSource, /case \.settings:[\s\S]*SettingsView\(showsAccountSettings: showsAccountSettings\)/);
  assert.match(rootViewSwiftSource, /ScannerHomeControls\([\s\S]*onScan: startCapture,[\s\S]*onConnections: \{ presentedSheet = \.connections \},[\s\S]*onSettings: \{ presentedSheet = \.settings \}/);
  assert.match(rootViewSwiftSource, /\.sheet\(item: \$presentedSheet\)[\s\S]*case \.connections:[\s\S]*CloudTargetPickerSheet\(\)[\s\S]*case \.settings:[\s\S]*SettingsSheet\(showsAccountSettings: showsAccountSettings\)/);
  assert.match(sharedScannerTabComponentsSwiftSource, /struct ScannerHomeControls: View/);
  assert.match(sharedScannerTabComponentsSwiftSource, /GlassEffectContainer\(spacing: 12\)/);
  assert.match(sharedScannerTabComponentsSwiftSource, /\.buttonStyle\([\s\S]*\.glass\(\.regular\.tint\(/);
  assert.match(sharedScannerTabComponentsSwiftSource, /content\.buttonStyle\(\.glassProminent\)/);
  assert.doesNotMatch(rootViewSwiftSource, /\.background\(\.bar\)|Divider\(\)/);
  assert.match(sharedScannerTabComponentsSwiftSource, /private var connectionsButton: some View[\s\S]*Image\(systemName: targetSymbol\)[\s\S]*\.frame\(width: 48, height: 48\)/);
  assert.match(rootViewSwiftSource, /private var targetSymbol: String[\s\S]*"cursorarrow\.motionlines"[\s\S]*"desktopcomputer\.trianglebadge\.exclamationmark"[\s\S]*"iphone"/);
  assert.match(cloudTargetPickerSwiftSource, /Label\(targetLabel, systemImage: "character\.cursor\.ibeam"\)[\s\S]*\.lineLimit\(1\)[\s\S]*\.frame\(minHeight: isCompact \? 36 : 48\)[\s\S]*\.contentShape\(Rectangle\(\)\)/);
  assert.match(cloudTargetPickerSwiftSource, /struct CloudTargetLabel: View[\s\S]*Label\(Self\.targetLabel\(for: store\), systemImage: "character\.cursor\.ibeam"\)[\s\S]*\.accessibilityElement\(children: \.combine\)/);
  assert.doesNotMatch(cloudTargetPickerSwiftSource, /pencil\.and\.scribble/);
  assert.match(scannerViewSwiftSource, /Text\("Volt"\)\.font\(\.largeTitle\.bold\(\)\)[\s\S]*CloudTargetLabel\(\)/);
  const scanHeaderStart = scannerViewSwiftSource.indexOf('Text("Volt").font(.largeTitle.bold())');
  const scanHeaderEnd = scannerViewSwiftSource.indexOf("UnifiedCaptureLaunchCard", scanHeaderStart);
  const scanHeaderSource = scannerViewSwiftSource.slice(scanHeaderStart, scanHeaderEnd);
  assert.doesNotMatch(scanHeaderSource, /CloudTargetButton|Button\(|buttonStyle|glass/);
  assert.match(scannerViewSwiftSource, /ComputerAvailabilityCard \{ isTargetPickerPresented = true \}/);
  assert.match(scannerViewSwiftSource, /\.sheet\(isPresented: \$isTargetPickerPresented\)[\s\S]*CloudTargetPickerSheet\(\)/);
  assert.match(scannerViewSwiftSource, /CaptureHistoryView[\s\S]*CloudTargetButton/);
  assert.match(cloudTargetPickerSwiftSource, /content\.buttonStyle\(\.glass\)[\s\S]*content\.buttonStyle\(\.bordered\)/);
  assert.ok(cloudTargetPickerSwiftSource.includes('.accessibilityLabel("Type destination: \\(targetLabel)")'));
  assert.match(sharedScannerTabComponentsSwiftSource, /\.accessibilityLabel\("Connections"\)[\s\S]*Choose the computer/);
  assert.match(sharedScannerTabComponentsSwiftSource, /Label\("Start", systemImage: "camera\.viewfinder"\)[\s\S]*\.accessibilityLabel\("Start"\)[\s\S]*\.accessibilityHint\("Starts the scanner"\)/);
  assert.match(sharedScannerTabComponentsSwiftSource, /Label\("Start", systemImage: "camera\.viewfinder"\)[\s\S]*\.frame\(maxWidth: \.infinity, minHeight: 48\)/);
  assert.match(sharedScannerTabComponentsSwiftSource, /Label\("Settings", systemImage: "gearshape"\)[\s\S]*\.labelStyle\(\.iconOnly\)/);
  assert.doesNotMatch(rootViewSwiftSource, /Label\("Upload"|UploadView\(\)/);
  assert.match(
    enumSource,
    /case text\s*case barcode\s*case photos\s*case dictation\s*case settings/
  );
});

test("full app side controls keep an explicit 48 point hit target with native glass buttons", () => {
  const connectionsStart = sharedScannerTabComponentsSwiftSource.indexOf("private var connectionsButton: some View");
  const scanStart = sharedScannerTabComponentsSwiftSource.indexOf("private var scanButton: some View", connectionsStart);
  const settingsStart = sharedScannerTabComponentsSwiftSource.indexOf("private var settingsButton: some View", scanStart);
  const connectionsSource = sharedScannerTabComponentsSwiftSource.slice(connectionsStart, scanStart);
  const settingsSource = sharedScannerTabComponentsSwiftSource.slice(settingsStart, sharedScannerTabComponentsSwiftSource.indexOf("}\n\nprivate struct RootTabBarGlassModifier", settingsStart));

  assert.ok(connectionsStart > -1);
  assert.ok(scanStart > connectionsStart);
  assert.ok(settingsStart > scanStart);
  assert.match(connectionsSource, /\.frame\(width: 48, height: 48\)[\s\S]*\.contentShape\(Rectangle\(\)\)/);
  assert.match(settingsSource, /\.frame\(width: 48, height: 48\)[\s\S]*\.contentShape\(Rectangle\(\)\)/);
  assert.match(connectionsSource, /\.rootTabBarGlass\(isSelected: false\)/);
  assert.match(settingsSource, /\.rootTabBarGlass\(isSelected: isSettingsSelected\)/);
  assert.match(settingsSource, /Button \{\s*onSettings\(\)/);
  assert.doesNotMatch(settingsSource, /selection = \.settings/);
  assert.match(sharedScannerTabComponentsSwiftSource, /content\.buttonStyle\([\s\S]*\.glass\(\.regular\.tint\(/);
  assert.match(sharedScannerTabComponentsSwiftSource, /\.buttonStyle\(\.bordered\)/);
  assert.match(sharedScannerTabComponentsSwiftSource, /GlassEffectContainer\(spacing: 12\)[\s\S]*\.shadow\(color: \.black\.opacity\(0\.24\), radius: 12, y: 6\)/);
  assert.match(rootViewSwiftSource, /\.safeAreaInset\(edge: \.bottom, spacing: 0\)[\s\S]*ScannerHomeControls\.reservedSpace/);
  assert.match(rootViewSwiftSource, /\.overlay\(alignment: \.bottom\)[\s\S]*GeometryReader \{ proxy in[\s\S]*\.padding\(\.horizontal, 16\)[\s\S]*\.padding\(\.bottom, 20\)[\s\S]*\.offset\(y: proxy\.safeAreaInsets\.bottom\)/);
  assert.match(settingsViewSwiftSource, /struct SettingsSheet: View[\s\S]*SettingsView\(showsAccountSettings: showsAccountSettings, showsDoneButton: true\)[\s\S]*\.presentationDetents\(\[\.medium, \.large\]\)[\s\S]*\.presentationDragIndicator\(\.visible\)/);
  assert.match(settingsViewSwiftSource, /if !showsDoneButton \{\s*store\.selectedSection = \.settings/);
});

test("full app uses Liquid Glass for floating status chrome without glassing content", () => {
  assert.match(voltBrandSwiftSource, /func voltGlassSurface\(cornerRadius: CGFloat\)/);
  assert.match(voltBrandSwiftSource, /content\.glassEffect\(\.regular, in: \.rect\(cornerRadius: cornerRadius\)\)/);
  assert.match(voltBrandSwiftSource, /content\.background\([\s\S]*\.regularMaterial/);
  assert.match(captureSessionViewSwiftSource, /CaptureDeliveryToastView[\s\S]*\.voltGlassSurface\(cornerRadius: 16\)/);
  assert.match(subscriptionActionsSwiftSource, /PaywallStatusBanner[\s\S]*\.voltGlassSurface\(cornerRadius: 14\)/);
  assert.doesNotMatch(scannerViewSwiftSource, /glassEffect|voltGlassSurface/);
  assert.doesNotMatch(settingsViewSwiftSource, /glassEffect|voltGlassSurface/);
});

test("full app Scan control requests a new capture even when Scan is selected", () => {
  assert.match(rootViewSwiftSource, /@State private var isCaptureSessionPresented = false/);
  assert.match(rootViewSwiftSource, /ScannerHomeControls\([\s\S]*onScan: startCapture/);
  assert.match(sharedScannerTabComponentsSwiftSource, /let onScan: \(\) -> Void/);
  assert.match(sharedScannerTabComponentsSwiftSource, /Button\(action: onScan\)/);
  assert.match(rootViewSwiftSource, /private func startCapture\(\) \{\s*selectedTab = \.text\s*store\.clearOcrReview\(\)\s*store\.beginCaptureSession\(\)\s*isCaptureSessionPresented = true/);
  assert.match(rootViewSwiftSource, /\.fullScreenCover\(isPresented: \$isCaptureSessionPresented/);
});
