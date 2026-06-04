import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const nativeFiles = {
  clipEntry: new URL("../clip-entry.tsx", import.meta.url),
  appClipPlan: new URL("../APP_CLIP_IMPLEMENTATION_PLAN.md", import.meta.url),
  appJson: new URL("../app.json", import.meta.url),
  deviceValidationRunbook: new URL("../docs/app-clip-device-validation.md", import.meta.url),
  barcodeCandidateGuard: new URL("../lib/barcode-candidate-guard.ts", import.meta.url),
  captureUrl: new URL("../lib/capture-url.ts", import.meta.url),
  clipResultRelay: new URL("../lib/clip-result-relay.ts", import.meta.url),
  clipInfoPlist: new URL("../ios/VoltClip/Info.plist", import.meta.url),
  clipEntitlements: new URL("../ios/VoltClip/VoltClip.entitlements", import.meta.url),
  fullAppInfoPlist: new URL("../ios/Volt/Info.plist", import.meta.url),
  fullAppEntitlements: new URL("../ios/Volt/Volt.entitlements", import.meta.url),
  fullAppDelegate: new URL("../ios/Volt/AppDelegate.swift", import.meta.url),
  packageJson: new URL("../package.json", import.meta.url),
  metroConfig: new URL("../metro.config.js", import.meta.url),
  xcodeProject: new URL("../ios/Volt.xcodeproj/project.pbxproj", import.meta.url),
  podfile: new URL("../ios/Podfile", import.meta.url),
  clipScreen: new URL("../clip/InvocationScreen.tsx", import.meta.url),
  barcodeScannerWrapper: new URL("../lib/volt-clip-barcode-scanner.ts", import.meta.url),
  dictationWrapper: new URL("../lib/volt-clip-dictation.ts", import.meta.url),
  scannerMessages: new URL("../lib/scanner-messages.ts", import.meta.url),
  textRecognizerWrapper: new URL("../lib/volt-clip-text-recognizer.ts", import.meta.url),
  barcodeScanner: new URL("../ios/VoltClip/VoltClipBarcodeScanner.swift", import.meta.url),
  dictation: new URL("../ios/VoltClip/VoltClipDictation.swift", import.meta.url),
  textRecognizer: new URL("../ios/VoltClip/VoltClipTextRecognizer.swift", import.meta.url),
  liquidTabBar: new URL("../ios/VoltClip/VoltClipLiquidTabBarView.swift", import.meta.url),
  liveTextImageView: new URL("../ios/Volt/LiveTextImageView.swift", import.meta.url),
  clipAppDelegate: new URL("../ios/VoltClip/AppDelegate.swift", import.meta.url),
};

function readText(url) {
  return readFileSync(url, "utf8");
}

function importedModules(source) {
  const modules = [];
  const importPattern = /(?:import\s+(?:type\s+)?[\s\S]*?\s+from\s+|import\s+|require\()["']([^"']+)["']/g;
  let match;

  while ((match = importPattern.exec(source))) {
    modules.push(match[1]);
  }

  return modules;
}

function importsPackage(moduleName, packageName) {
  return moduleName === packageName || moduleName.startsWith(`${packageName}/`);
}

test("App Clip Info.plist contains native capture permission strings", () => {
  const plist = readText(nativeFiles.clipInfoPlist);

  for (const key of [
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
  ]) {
    assert.match(plist, new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`));
  }
  assert.match(plist, /NSSpeechRecognitionUsageDescription/);
  assert.match(plist, /does not expose dictation/);
});

test("full app Info.plist keeps matching permission strings for shared capture behavior", () => {
  const clipPlist = readText(nativeFiles.clipInfoPlist);
  const fullAppPlist = readText(nativeFiles.fullAppInfoPlist);

  for (const key of [
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
  ]) {
    const clipMatch = clipPlist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
    const fullAppMatch = fullAppPlist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
    assert.equal(fullAppMatch?.[1], clipMatch?.[1]);
  }
});

test("App Clip native modules request the permissions required by their capture APIs", () => {
  assert.match(readText(nativeFiles.barcodeScanner), /AVCaptureDevice\.requestAccess\(for: \.video\)/);
  assert.match(readText(nativeFiles.textRecognizer), /AVCaptureDevice\.requestAccess\(for: \.video\)/);

  const dictation = readText(nativeFiles.dictation);
  assert.doesNotMatch(dictation, /SFSpeechRecognizer/);
  assert.match(dictation, /requestRecordPermission/);
});

test("App Clip subscribes to native capture error events", () => {
  const barcodeScanner = readText(nativeFiles.barcodeScanner);
  const dictation = readText(nativeFiles.dictation);
  const barcodeWrapper = readText(nativeFiles.barcodeScannerWrapper);
  const dictationWrapper = readText(nativeFiles.dictationWrapper);
  const clipScreen = readText(nativeFiles.clipScreen);

  assert.match(barcodeScanner, /\["candidate", "error"\]/);
  assert.match(dictation, /\["audioChunk", "error"\]/);
  assert.match(barcodeWrapper, /addVoltClipBarcodeErrorListener/);
  assert.match(dictationWrapper, /addVoltClipDictationErrorListener/);
  assert.match(dictationWrapper, /addVoltClipDictationAudioChunkListener/);
  assert.match(clipScreen, /addVoltClipBarcodeErrorListener/);
  assert.match(clipScreen, /addVoltClipDictationErrorListener/);
});

test("App Clip OCR emits the frozen capture before text recognition completes", () => {
  const textRecognizer = readText(nativeFiles.textRecognizer);
  const textRecognizerWrapper = readText(nativeFiles.textRecognizerWrapper);
  const clipScreen = readText(nativeFiles.clipScreen);

  assert.match(textRecognizer, /supportedEvents\(\).*?\["capture", "orientation"\]/s);
  assert.match(textRecognizer, /let relayImage = prepareRelayImage\(from: data\)/);
  assert.match(textRecognizer, /emitCapturedImage\(imageURL: imageURL, imageData: relayImage\.data, imageSize: relayImage\.size\)/);
  assert.match(textRecognizer, /recognizeText\(in: cgImage, orientation: orientation, imageURL: imageURL\)/);
  assert.match(textRecognizer, /relayImageMaxDimension: CGFloat = 960/);
  assert.match(textRecognizerWrapper, /addVoltClipTextCaptureListener/);
  assert.match(clipScreen, /setOcrFrozenImageUri\(result\.imageUri\)/);
});

test("App Clip photo capture applies physical device orientation before relay normalization", () => {
  const textRecognizer = readText(nativeFiles.textRecognizer);
  const textRecognizerWrapper = readText(nativeFiles.textRecognizerWrapper);
  const clipScreen = readText(nativeFiles.clipScreen);

  assert.match(textRecognizer, /UIDevice\.orientationDidChangeNotification/);
  assert.match(textRecognizer, /self\.applyCurrentCaptureOrientation\(\)\s*self\.output\.capturePhoto/s);
  assert.match(textRecognizer, /connection\.videoOrientation = orientation/);
  assert.match(textRecognizer, /imageOrientation\(from: imageSource, fallback: fallbackOrientation\)/);
  assert.match(textRecognizer, /cgImageOrientation\(for: currentVideoOrientation\(\)\)/);
  assert.match(textRecognizerWrapper, /addVoltClipDeviceOrientationListener/);
  assert.match(clipScreen, /captureControlsRotationDegrees/);
  assert.match(clipScreen, /rotate: `\$\{captureControlsRotationDegrees\}deg`/);
});

test("App Clip photo mode keeps the captured photo visible while sending", () => {
  const clipScreen = readText(nativeFiles.clipScreen);

  assert.match(clipScreen, /capturedOcrImageUri && mode === "photo"/);
  assert.match(clipScreen, /photoCapturedFrame/);
  assert.match(clipScreen, /source=\{\{ uri: capturedOcrImageUri \}\}/);
  assert.match(clipScreen, /Sending this photo to Chrome/);
  assert.match(clipScreen, /Stored in Chrome\. Ready for the next photo\./);
  assert.match(clipScreen, /Capture another photo/);
});

test("App Clip does not expose dictation mode from the dedicated clip entry", () => {
  const clipScreen = readText(nativeFiles.clipScreen);

  assert.match(clipScreen, /const clipModes = \["ocr", "barcode", "photo"\] as const/);
  assert.doesNotMatch(clipScreen, /from "\.\.\/lib\/volt-clip-dictation"/);
});

test("App Clip barcode scanner returns native preview geometry for active code highlighting", () => {
  const textRecognizer = readText(nativeFiles.textRecognizer);
  const barcodeWrapper = readText(nativeFiles.barcodeScannerWrapper);
  const clipScreen = readText(nativeFiles.clipScreen);

  assert.match(textRecognizer, /transformedMetadataObject\(for: metadataObject\)/);
  assert.match(textRecognizer, /payload\["bounds"\]/);
  assert.match(textRecognizer, /payload\["corners"\]/);
  assert.match(barcodeWrapper, /bounds\?: \{ x: number; y: number; width: number; height: number \}/);
  assert.match(clipScreen, /NativeBarcodeHighlight/);
  assert.doesNotMatch(clipScreen, /ocrBarcodeScanLine/);
});

test("native App Clip barcode scanner normalizes UPC-A and rejects numeric noise", () => {
  const appDelegate = readText(nativeFiles.clipAppDelegate);
  const fullAppDelegate = readText(nativeFiles.fullAppDelegate);

  for (const source of [appDelegate, fullAppDelegate]) {
    assert.match(source, /normalizedBarcode\(value: String, type: AVMetadataObject\.ObjectType\)/);
    assert.match(source, /type == \.ean13, value\.range\(of: #"\^0\\d\{12\}\$"#/);
    assert.match(source, /return \(String\(value\.dropFirst\(\)\), "upc_a"\)/);
    assert.match(source, /isUselessBarcodeValue/);
    assert.match(source, /digitsOnly && value\.count <= 5/);
    assert.match(source, /value\.allSatisfy\(\{ \$0 == first \}\)/);
    assert.match(source, /\.sorted \{ left, right in/);
  }
});

test("App Clip dictation permission denial offers retry or Settings recovery", () => {
  const clipScreen = readText(nativeFiles.clipScreen);

  assert.match(clipScreen, /Alert\.alert\(\s*"Enable dictation"/);
  assert.match(clipScreen, /Linking\.openSettings\(\)/);
  assert.match(clipScreen, /canRequestDictationPermissionAgain/);
});

test("App Clip dictation collapsed controls keep capture mode switching visible", () => {
  const clipScreen = readText(nativeFiles.clipScreen);

  assert.match(clipScreen, /ocrCollapsedDictationControls/);
  assert.match(clipScreen, /ocrDictationSurfaceModeOptions/);
  assert.match(clipScreen, /renderClipModeSelector\(styles\.ocrDictationSurfaceModeOptions\)/);
  assert.match(clipScreen, /\{renderClipModeSelector\(\)\}/);
  assert.match(clipScreen, /accessibilityRole="tablist"/);
  assert.match(clipScreen, /clipModes\.map\(\(nextMode\)/);
  assert.match(clipScreen, /onPress=\{\(\) => switchClipMode\(nextMode\)\}/);
});

test("App Clip OCR captured image has stable pan and zoom room for Live Text selection", () => {
  const clipScreen = readText(nativeFiles.clipScreen);
  const liveTextImageView = readText(nativeFiles.liveTextImageView);

  assert.match(clipScreen, /contentInsetAdjustmentBehavior="never"/);
  assert.match(clipScreen, /ocrCapturedScrollContent/);
  assert.match(clipScreen, /paddingBottom: ocrDrawerCollapsedHeight \+ stableBottomInset \+ 180/);
  assert.match(liveTextImageView, /contentMode = \.scaleAspectFit/);
});

test("full app OCR captured image normalizes enhanced Live Text orientation", () => {
  const liveTextImageView = readText(nativeFiles.liveTextImageView);

  assert.match(liveTextImageView, /UIImage\(cgImage: cgImage, scale: image\.scale, orientation: \.up\)/);
});

test("full app OCR captured image has stable pan and zoom room for Live Text selection", () => {
  const ocrScreen = readText(new URL("../app/(tabs)/index.tsx", import.meta.url));

  assert.match(ocrScreen, /bouncesZoom/);
  assert.match(ocrScreen, /centerContent/);
  assert.match(ocrScreen, /minHeight: capturedViewportSize\.height \+ 240/);
  assert.match(ocrScreen, /paddingBottom: 180/);
  assert.match(ocrScreen, /paddingTop: 72/);
});

test("App Clip bottom controls use native Liquid Glass with concentric screen corners", () => {
  const clipScreen = readText(nativeFiles.clipScreen);
  const liquidTabBar = readText(nativeFiles.liquidTabBar);

  assert.match(clipScreen, /const ocrDrawerCollapsedHeight = 158/);
  assert.match(clipScreen, /const ocrDrawerEdgeBleed = 2/);
  assert.match(clipScreen, /const ocrDrawerExpandedInset = -ocrDrawerEdgeBleed/);
  assert.match(clipScreen, /const ocrDrawerExpandedRadius = 34/);
  assert.match(clipScreen, /LiquidTabBarView \?/);
  assert.match(clipScreen, /inputRange: \[0, 0\.72, 1\]/);
  assert.match(liquidTabBar, /NSClassFromString\("UIGlassEffect"\)/);
  assert.match(liquidTabBar, /UIGlassEffect\(style: \.regular\)/);
  assert.match(liquidTabBar, /blurView\.cornerConfiguration = \.corners/);
  assert.match(liquidTabBar, /UITabBarDelegate/);
  assert.match(liquidTabBar, /UITabBarAppearance/);
  assert.doesNotMatch(liquidTabBar, /VoltClipModeTabButton/);
});

test("native bottom controls sheet opens with tap and native drag gestures", () => {
  const fullDelegate = readText(nativeFiles.fullAppDelegate);
  const clipDelegate = readText(nativeFiles.clipAppDelegate);
  const nativeDelegates = [fullDelegate, clipDelegate].join("\n");

  assert.match(nativeDelegates, /private func toggleBottomSheetExpansion\(\)/);
  assert.match(nativeDelegates, /\.onTapGesture\s*\{\s*toggleBottomSheetExpansion\(\)/);
  assert.match(nativeDelegates, /withAnimation\(\.interactiveSpring\(response: 0\.30, dampingFraction: 0\.88\)\)/);
  assert.match(nativeDelegates, /bottomSheetExpansion = bottomSheetExpansion > 0\.5 \? 0 : 1/);
  assert.match(nativeDelegates, /@GestureState private var bottomSheetDragTranslation: CGFloat = 0/);
  assert.match(nativeDelegates, /private var liveBottomSheetExpansion: CGFloat/);
  assert.match(nativeDelegates, /clampedBottomSheetExpansion\(bottomSheetExpansion - \(bottomSheetDragTranslation \/ expandedSheetHeight\)\)/);
  assert.match(nativeDelegates, /private var bottomSheetResizeGesture: some Gesture/);
  assert.match(nativeDelegates, /DragGesture\(minimumDistance: 10\)/);
  assert.match(nativeDelegates, /\.gesture\(bottomSheetResizeGesture\)/);
  assert.match(nativeDelegates, /\.updating\(\$bottomSheetDragTranslation\)/);
  assert.match(nativeDelegates, /transaction\.disablesAnimations = true/);
  assert.match(nativeDelegates, /value\.predictedEndTranslation\.height/);
  assert.doesNotMatch(nativeDelegates, /bottomSheetDragStartExpansion/);
});

test("native bottom controls sheet has hidden blur and hue appearance controls", () => {
  const fullDelegate = readText(nativeFiles.fullAppDelegate);
  const clipDelegate = readText(nativeFiles.clipAppDelegate);
  const nativeDelegates = [fullDelegate, clipDelegate].join("\n");

  assert.match(nativeDelegates, /@State private var glassBlurIntensity: CGFloat = 0\.72/);
  assert.match(nativeDelegates, /@State private var glassHue: CGFloat = 0/);
  assert.match(nativeDelegates, /private let expandedSheetHeight: CGFloat = 148/);
  assert.match(nativeDelegates, /private var glassTintIsActive: Bool/);
  assert.match(nativeDelegates, /glassHue > 0\.001/);
  assert.match(nativeDelegates, /private var glassAccentColor: Color\?/);
  assert.match(nativeDelegates, /private var glassTintColor: Color\?/);
  assert.match(nativeDelegates, /guard glassTintIsActive else \{ return nil \}/);
  assert.match(nativeDelegates, /private var glassControlColor: Color/);
  assert.match(nativeDelegates, /glassAccentColor \?\? \.white/);
  assert.match(nativeDelegates, /Color\(hue: Double\(glassHue\), saturation: 0\.74, brightness: 0\.96\)/);
  assert.match(nativeDelegates, /Color\(hue: Double\(glassHue\), saturation: 0\.52, brightness: 0\.88\)/);
  assert.match(nativeDelegates, /Text\("Color hue"\)/);
  assert.match(nativeDelegates, /Text\(glassTintIsActive \? "\\\(Int\(\(glassHue \* 360\)\.rounded\(\)\)\)°" : "Original"\)/);
  assert.match(nativeDelegates, /Double\(glassHue\)[\s\S]*glassHue = CGFloat\(value\)/);
  assert.match(nativeDelegates, /\.tint\(glassControlColor\)/);
  assert.match(nativeDelegates, /accentColor: glassAccentColor/);
  assert.match(nativeDelegates, /tintColor: glassTintColor/);
  assert.match(nativeDelegates, /let accentColor: Color\?/);
  assert.match(nativeDelegates, /let tintColor: Color\?/);
  assert.match(nativeDelegates, /ConcentricLiquidDrawer\(cornerRadius: 40, blurIntensity: glassBlurIntensity, tintColor: glassTintColor\)/);
  assert.match(nativeDelegates, /BlurSheetSlide\(progress: expansion, tintColor: glassTintColor\)/);
  assert.match(nativeDelegates, /nativeBlurredGlassBackground\(Circle\(\), intensity: glassBlurIntensity, tintColor: glassTintColor\)/);
  assert.match(nativeDelegates, /nativeBlurredGlassBackground\(RoundedRectangle\(cornerRadius: 27, style: \.continuous\), intensity: glassBlurIntensity, tintColor: glassTintColor\)/);
  assert.match(nativeDelegates, /func nativeClearGlassBackground<S: Shape>\(_ shape: S, tintColor: Color\? = nil\)/);
  assert.match(nativeDelegates, /func nativeBlurredGlassBackground<S: Shape>\(_ shape: S, intensity: CGFloat = 0\.72, tintColor: Color\? = nil\)/);
  assert.match(nativeDelegates, /if let tintColor[\s\S]*shape\s*\.fill\(tintColor\.opacity\(0\.16 \+ \(0\.12 \* clampedIntensity\)\)\)/);
  assert.match(nativeDelegates, /let selectedFill = accentColor\?\.opacity\(0\.24\) \?\? Color\.white\.opacity\(0\.18\)/);
});

test("App Clip native view wrappers guard unregistered components", () => {
  const textRecognizerWrapper = readText(nativeFiles.textRecognizerWrapper);

  assert.match(textRecognizerWrapper, /UIManager/);
  assert.match(textRecognizerWrapper, /getViewManagerConfig\(nativeComponentName\) != null/);
  assert.match(textRecognizerWrapper, /hasNativeTextCameraView\s*\?/);
});

test("App Clip target is configured with invocation-critical bundle id and entitlements", () => {
  const project = readText(nativeFiles.xcodeProject);
  const clipEntitlements = readText(nativeFiles.clipEntitlements);
  const fullAppEntitlements = readText(nativeFiles.fullAppEntitlements);

  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.volt\.mobile\.Clip;/);
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = VoltClip\/VoltClip\.entitlements;/);
  assert.match(clipEntitlements, /com\.apple\.developer\.on-demand-install-capable/);
  assert.match(clipEntitlements, /appclips:scanner-signal\.vercel\.app/);
  assert.match(clipEntitlements, /\$\(AppIdentifierPrefix\)com\.volt\.mobile/);
  assert.match(fullAppEntitlements, /\$\(AppIdentifierPrefix\)com\.volt\.mobile\.Clip/);
  assert.match(fullAppEntitlements, /applinks:scanner-signal\.vercel\.app/);
});

test("App Clip target bundles the dedicated entry with clip-specific module resolution", () => {
  const project = readText(nativeFiles.xcodeProject);
  const metroConfig = readText(nativeFiles.metroConfig);
  const clipEntry = readText(nativeFiles.clipEntry);

  assert.match(project, /export BUILDING_FOR_APP_CLIP=1/);
  assert.match(project, /clip-entry\.tsx/);
  assert.match(metroConfig, /process\.env\.BUILDING_FOR_APP_CLIP/);
  assert.match(metroConfig, /`clip\.\$\{extension\}`/);
  assert.match(clipEntry, /from "\.\/clip\/InvocationScreen"/);
  assert.doesNotMatch(clipEntry, /expo-router\/entry/);
  assert.doesNotMatch(clipEntry, /react-native\/Libraries\//);
});

test("mobile debug packagers use repo-specific ports outside the shared React Native default range", () => {
  const packageJson = JSON.parse(readText(nativeFiles.packageJson));
  const fullDelegate = readText(nativeFiles.fullAppDelegate);
  const clipDelegate = readText(nativeFiles.clipAppDelegate);

  assert.match(packageJson.scripts.dev, /RCT_METRO_PORT=8090/);
  assert.match(packageJson.scripts.dev, /--port 8090/);
  assert.match(packageJson.scripts["dev:device"], /RCT_METRO_PORT=8090/);
  assert.match(packageJson.scripts["dev:device"], /--port 8090/);
  assert.match(packageJson.scripts["dev:clip"], /RCT_METRO_PORT=8091/);
  assert.match(packageJson.scripts["dev:clip"], /--port 8091/);
  assert.ok(fullDelegate.includes('provider.jsLocation = "\\(ip):8090"'));
  assert.ok(clipDelegate.includes('provider.jsLocation = "\\(ip):8091"'));
  assert.doesNotMatch(fullDelegate, /:808[0-9]"/);
  assert.doesNotMatch(clipDelegate, /:808[0-9]"/);
});

test("App Clip excludes native packages not imported by the dedicated clip entry", () => {
  const appJson = JSON.parse(readText(nativeFiles.appJson));
  const podfile = readText(nativeFiles.podfile);
  const pluginConfig = appJson.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "react-native-app-clip"
  )?.[1];
  const excludedPackages = pluginConfig?.excludedPackages ?? [];

  for (const packageName of [
    "@react-native-async-storage/async-storage",
    "@react-native-masked-view/masked-view",
    "expo-asset",
    "expo-font",
    "expo-linking",
    "expo-router",
    "react-native-gesture-handler",
    "react-native-get-random-values",
    "react-native-reanimated",
    "react-native-screens",
    "react-native-svg",
    "react-native-webrtc",
    "react-native-worklets",
  ]) {
    assert.ok(excludedPackages.includes(packageName), `${packageName} missing from app.json exclusions`);
    assert.match(podfile, new RegExp(packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("dedicated App Clip JavaScript does not import excluded native packages", () => {
  const appJson = JSON.parse(readText(nativeFiles.appJson));
  const pluginConfig = appJson.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "react-native-app-clip"
  )?.[1];
  const excludedPackages = pluginConfig?.excludedPackages ?? [];
  const clipSources = [
    nativeFiles.clipEntry,
    nativeFiles.clipScreen,
    nativeFiles.barcodeCandidateGuard,
    nativeFiles.captureUrl,
    nativeFiles.clipResultRelay,
    nativeFiles.scannerMessages,
    nativeFiles.barcodeScannerWrapper,
    nativeFiles.dictationWrapper,
    nativeFiles.textRecognizerWrapper,
  ];

  for (const sourceUrl of clipSources) {
    const imports = importedModules(readText(sourceUrl));
    for (const moduleName of imports) {
      for (const packageName of excludedPackages) {
        assert.equal(
          importsPackage(moduleName, packageName),
          false,
          `${sourceUrl.pathname} imports excluded App Clip package ${packageName} via ${moduleName}`
        );
      }
    }
  }
});

test("full app pair route accepts every browser relay capture mode", () => {
  const pairRoute = readText(new URL("../app/pair.tsx", import.meta.url));
  const captureModes = readText(new URL("./capture-modes.ts", import.meta.url));

  for (const mode of ["ocr", "barcode", "dictation", "photo"]) {
    assert.match(captureModes, new RegExp(`${mode}:`));
  }
  assert.ok(captureModes.includes('ocr: "/(tabs)/scanner"'));
  assert.ok(captureModes.includes('dictation: "/(tabs)/scanner"'));
  assert.ok(captureModes.includes('photo: "/(tabs)/scanner"'));
  assert.match(pairRoute, /buildPairUrl\(session, mode, joinToken\)/);
  assert.match(pairRoute, /scanner\.setActiveMode\(mode\)/);
});

test("native App Clip parser accepts generic browser relay QR sessions", () => {
  const fullDelegate = readText(nativeFiles.fullAppDelegate);
  const beginPairing = fullDelegate.match(/func beginPairing\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";

  assert.match(fullDelegate, /let mode: ClipMode\?/);
  assert.doesNotMatch(fullDelegate, /mode = invocation\.mode \?\? mode/);
  assert.match(fullDelegate, /stopMode\(\)[\s\S]*sessionId = invocation\.sessionId[\s\S]*startMode\(\)/);
  assert.doesNotMatch(beginPairing, /mode = \.barcode/);
  assert.match(fullDelegate, /let mode = modeValue\.flatMap/);
  assert.doesNotMatch(fullDelegate, /guard\s+let modeValue,[\s\S]*let mode = ClipMode\(rawValue: modeValue\),[\s\S]*let session,/);
});

test("native dictation feedback distinguishes unpaired, tap, hold, and stop states", () => {
  const fullDelegate = readText(nativeFiles.fullAppDelegate);
  const clipDelegate = readText(nativeFiles.clipAppDelegate);

  assert.match(fullDelegate, /Pair with Chrome to dictate/);
  assert.match(fullDelegate, /Tap to start or hold to speak/);
  assert.match(fullDelegate, /Waiting for dictation/);
  assert.match(fullDelegate, /Tap stop when done/);
  assert.match(fullDelegate, /dictationHoldRecording[\s\S]*Release to send/);
  assert.match(fullDelegate, /finishAndStop\(tailDuration: 0, timeout: 0\.8\)/);
  assert.doesNotMatch(fullDelegate, /Writing to \\?\#?\(model\.cursorTargetName\)/);

  assert.match(clipDelegate, /Pair with Chrome to dictate/);
  assert.match(clipDelegate, /finishAndStop\(tailDuration: 0, timeout: 0\.8\)/);
  assert.doesNotMatch(clipDelegate, /Writing to \\?\#?\(model\.cursorTargetName\)/);
});

test("native dictation mixes with Bluetooth media playback", () => {
  const fullDelegate = readText(nativeFiles.fullAppDelegate);
  const clipDelegate = readText(nativeFiles.clipAppDelegate);
  const clipDictationModule = readText(nativeFiles.dictation);
  const nativeDictationSources = [fullDelegate, clipDelegate, clipDictationModule].join("\n");
  const fullStartMode = fullDelegate.match(/func startMode\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  const clipStartMode = clipDelegate.match(/func startMode\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";

  assert.doesNotMatch(nativeDictationSources, /duckOthers/);
  assert.doesNotMatch(nativeDictationSources, /allowBluetoothHFP/);
  assert.match(nativeDictationSources, /mixWithOthers/);
  assert.match(nativeDictationSources, /allowBluetoothA2DP/);
  assert.match(nativeDictationSources, /func preparePermissionsForUse\(\) async throws/);
  assert.match(fullStartMode, /dictation\.preparePermissionsForUse\(\)/);
  assert.match(clipStartMode, /dictation\.preparePermissionsForUse\(\)/);
  assert.doesNotMatch(fullStartMode, /dictation\.prepareForUse\(\)/);
  assert.doesNotMatch(clipStartMode, /dictation\.prepareForUse\(\)/);
});

test("mobile mode picker is a small sliding Liquid Glass text strip", () => {
  const fullDelegate = readText(nativeFiles.fullAppDelegate);
  const clipDelegate = readText(nativeFiles.clipAppDelegate);
  const fullModePicker = fullDelegate.match(/private var modePicker: some View \{[\s\S]*?\n  \}/)?.[0] ?? "";
  const clipModePicker = clipDelegate.match(/private var modePicker: some View \{[\s\S]*?\n  \}/)?.[0] ?? "";

  assert.match(fullModePicker, /CameraModeGlassStrip/);
  assert.match(clipModePicker, /CameraModeGlassStrip/);
  assert.match(fullDelegate, /CameraModeTextButton/);
  assert.match(clipDelegate, /CameraModeTextButton/);
  assert.match(fullDelegate, /modePickerIsDragging/);
  assert.match(clipDelegate, /modePickerIsDragging/);
  assert.match(fullDelegate, /offset\(x: modePickerIsDragging \? 26 : 0\)/);
  assert.match(clipDelegate, /offset\(x: modePickerIsDragging \? 26 : 0\)/);
  assert.match(fullDelegate, /Text\(mode\.title\.uppercased\(\)\)/);
  assert.match(clipDelegate, /Text\(mode\.title\.uppercased\(\)\)/);
  assert.match(fullDelegate, /LinearGradient\(/);
  assert.match(clipDelegate, /LinearGradient\(/);
  assert.match(fullDelegate, /gestureStartIndex/);
  assert.match(clipDelegate, /gestureStartIndex/);
  assert.match(fullDelegate, /@State private var dragOffset/);
  assert.match(clipDelegate, /@State private var dragOffset/);
  assert.match(fullDelegate, /dragOffset = value\.translation\.width/);
  assert.match(clipDelegate, /dragOffset = value\.translation\.width/);
  assert.match(fullDelegate, /rawOffset = -value\.translation\.width \/ itemWidth/);
  assert.match(clipDelegate, /rawOffset = -value\.translation\.width \/ itemWidth/);
  assert.match(fullDelegate, /if isDragging \{\s*transaction\.animation = nil/s);
  assert.match(clipDelegate, /if isDragging \{\s*transaction\.animation = nil/s);
  assert.match(fullDelegate, /\.font\(\.system\(size: 13/);
  assert.match(clipDelegate, /\.font\(\.system\(size: 13/);
  assert.match(fullDelegate, /ConcentricLiquidDrawer\(cornerRadius: 40\)/);
  assert.match(clipDelegate, /ConcentricLiquidDrawer\(cornerRadius: 40\)/);
  assert.doesNotMatch(fullModePicker, /GroupedGlassModePicker/);
  assert.doesNotMatch(clipModePicker, /GroupedGlassModePicker/);
  assert.doesNotMatch(fullModePicker, /NativeLiquidModePicker/);
  assert.doesNotMatch(clipModePicker, /NativeLiquidModePicker/);
  assert.doesNotMatch(fullDelegate, /NativeModeSegmentedPicker/);
  assert.doesNotMatch(clipDelegate, /NativeModeSegmentedPicker/);
});

test("App Clip plan links the physical device validation runbook", () => {
  const plan = readText(nativeFiles.appClipPlan);
  const runbook = readText(nativeFiles.deviceValidationRunbook);

  assert.match(plan, /apps\/mobile\/docs\/app-clip-device-validation\.md/);
  assert.match(plan, /preflight:clip/);
  assert.match(plan, /create:device-validation-session/);
  assert.match(runbook, /App Store Connect Evidence/);
  assert.match(runbook, /Capture And Insertion Matrix/);
  assert.match(runbook, /create:device-validation-session/);
  assert.match(runbook, /app-thinning-size-report/);
});
