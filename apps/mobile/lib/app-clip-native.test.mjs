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
  metroConfig: new URL("../metro.config.js", import.meta.url),
  xcodeProject: new URL("../ios/Volt.xcodeproj/project.pbxproj", import.meta.url),
  podfile: new URL("../ios/Podfile", import.meta.url),
  clipScreen: new URL("../app/clip/[mode].clip.tsx", import.meta.url),
  barcodeScannerWrapper: new URL("../lib/volt-clip-barcode-scanner.ts", import.meta.url),
  dictationWrapper: new URL("../lib/volt-clip-dictation.ts", import.meta.url),
  scannerMessages: new URL("../lib/scanner-messages.ts", import.meta.url),
  textRecognizerWrapper: new URL("../lib/volt-clip-text-recognizer.ts", import.meta.url),
  barcodeScanner: new URL("../ios/VoltClip/VoltClipBarcodeScanner.swift", import.meta.url),
  dictation: new URL("../ios/VoltClip/VoltClipDictation.swift", import.meta.url),
  textRecognizer: new URL("../ios/VoltClip/VoltClipTextRecognizer.swift", import.meta.url),
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
    "NSSpeechRecognitionUsageDescription",
  ]) {
    assert.match(plist, new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`));
  }
});

test("full app Info.plist keeps matching permission strings for shared capture behavior", () => {
  const clipPlist = readText(nativeFiles.clipInfoPlist);
  const fullAppPlist = readText(nativeFiles.fullAppInfoPlist);

  for (const key of [
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
    "NSSpeechRecognitionUsageDescription",
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
  assert.match(dictation, /SFSpeechRecognizer\.requestAuthorization/);
  assert.match(dictation, /requestRecordPermission/);
});

test("App Clip subscribes to native capture error events", () => {
  const barcodeScanner = readText(nativeFiles.barcodeScanner);
  const dictation = readText(nativeFiles.dictation);
  const barcodeWrapper = readText(nativeFiles.barcodeScannerWrapper);
  const dictationWrapper = readText(nativeFiles.dictationWrapper);
  const clipScreen = readText(nativeFiles.clipScreen);

  assert.match(barcodeScanner, /\["candidate", "error"\]/);
  assert.match(dictation, /\["partial", "final", "error"\]/);
  assert.match(barcodeWrapper, /addVoltClipBarcodeErrorListener/);
  assert.match(dictationWrapper, /addVoltClipDictationErrorListener/);
  assert.match(clipScreen, /addVoltClipBarcodeErrorListener/);
  assert.match(clipScreen, /addVoltClipDictationErrorListener/);
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
  assert.match(clipEntry, /from "\.\/app\/clip\/\[mode\]\.clip"/);
  assert.doesNotMatch(clipEntry, /expo-router\/entry/);
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
