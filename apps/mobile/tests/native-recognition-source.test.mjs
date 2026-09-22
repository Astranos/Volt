import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { scannerProtocolGolden } from "@volt/scanner-protocol/protocol-fixtures";
import {
  scannerStoreCaptureActionsSwiftSource,
  cameraModelSwiftSource,
  scannerRecognitionModelsSwiftSource,
  scannerCameraLayerSwiftSource,
  captureSessionViewSwiftSource,
  cameraSessionControlsSwiftSource,
  sharedCameraSessionControlsSwiftSource,
  sharedCaptureSessionOverlaysSwiftSource,
  ocrReviewLayerSwiftSource,
  textRecognizerSwiftSource,
  ocrTextCleanerSwiftSource,
  clipBarcodeScannerServiceSwiftSource,
} from "./native-source-fixtures.mjs";

test("native OCR review stops the live camera until retake", () => {
  assert.match(captureSessionViewSwiftSource, /struct CaptureSessionView/);
  assert.match(captureSessionViewSwiftSource, /\.onChange\(of: store\.ocrReviewImage != nil\)/);
  assert.match(captureSessionViewSwiftSource, /syncCameraForCaptureState\(isReviewingOcr: store\.ocrReviewImage != nil\)/);
  assert.match(captureSessionViewSwiftSource, /private func syncCameraForCaptureState\(isReviewingOcr: Bool\)/);
  assert.match(captureSessionViewSwiftSource, /if isReviewingOcr \|\| store\.activeMode == \.dictation \{\s*store\.camera\.stop\(\)\s*return\s*\} else \{[\s\S]*store\.camera\.start\(\)/);
});

test("native OCR review separates pan gestures from selectable text targets", () => {
  assert.match(ocrReviewLayerSwiftSource, /@State private var isPanning = false/);
  assert.match(ocrReviewLayerSwiftSource, /lastPanEndedAt = Date\(\)/);
  assert.match(ocrReviewLayerSwiftSource, /Date\(\)\.timeIntervalSince\(lastPanEndedAt\) > panSelectionSuppression/);
  assert.match(ocrReviewLayerSwiftSource, /minimumTapTargetSize \/ currentScale/);
});

test("native OCR review renders Vision quadrilaterals for angled text", () => {
  assert.match(scannerRecognitionModelsSwiftSource, /struct TextQuadrilateral: Equatable/);
  assert.match(scannerRecognitionModelsSwiftSource, /init\(observation: VNRectangleObservation\)/);
  assert.match(textRecognizerSwiftSource, /quadrilateral: TextQuadrilateral\(observation: observation\)/);
  assert.match(ocrReviewLayerSwiftSource, /OcrRegionShape\(points: points\)/);
  assert.match(ocrReviewLayerSwiftSource, /viewPoints\(for: region\.quadrilateral/);
});

test("native OCR review auto-cleans selected text while preserving a raw fallback", () => {
  assert.match(ocrTextCleanerSwiftSource, /import FoundationModels/);
  assert.match(ocrTextCleanerSwiftSource, /enum OcrTextCleaner/);
  assert.match(ocrTextCleanerSwiftSource, /static func clean\(text: String, context: String = ""\) async -> OcrTextCleanupResult/);
  assert.match(ocrTextCleanerSwiftSource, /SystemLanguageModel\(/);
  assert.match(ocrTextCleanerSwiftSource, /LanguageModelSession\(/);
  assert.match(ocrTextCleanerSwiftSource, /if let match = LiveTextIdentifierMatcher\.match\(normalized\) \{[\s\S]*isAppleSerialContext\(context\)/);
  assert.match(ocrTextCleanerSwiftSource, /Nearby OCR context \(reference only; never return it\)/);
  assert.match(ocrTextCleanerSwiftSource, /let sanitizedText = sanitizeModelOutput\(response\.content, fallback: fallbackText, context: context\)[\s\S]*authoritativeCleanup\(sanitizedText, context: context\)/);
  assert.match(ocrTextCleanerSwiftSource, /private static func authoritativeCleanup\(_ text: String, context: String\)/);
  assert.match(ocrTextCleanerSwiftSource, /private static func repairedIMEI\(in text: String\)/);
  assert.match(ocrTextCleanerSwiftSource, /private static func isAppleSerialContext\(_ context: String\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /let recognizedRegions = try await TextRecognizer\.recognizeTextRegions\(in: preparedImage\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /ocrTextRegions = DeviceIdentifierRegionExtractor\.reviewRegions\(from: recognizedRegions\)/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /ocrReviewText = ocrTextRegions\.map\(\\\.text\)\.joined\(separator: "\\n"\)/);
  assert.doesNotMatch(scannerStoreCaptureActionsSwiftSource, /OcrTextCleaner\.clean/);
});

test("native camera can detect identifier candidates before OCR capture", () => {
  assert.match(cameraModelSwiftSource, /private let videoOutput = AVCaptureVideoDataOutput\(\)/);
  assert.match(cameraModelSwiftSource, /private let liveTextFrameProcessor = LiveTextFrameProcessor\(\)/);
  assert.match(cameraModelSwiftSource, /videoOutput\.alwaysDiscardsLateVideoFrames = true/);
  assert.match(cameraModelSwiftSource, /videoOutput\.setSampleBufferDelegate\(liveTextFrameProcessor, queue: videoQueue\)/);
  assert.match(cameraModelSwiftSource, /VNRecognizeTextRequest/);
  assert.match(cameraModelSwiftSource, /request\.recognitionLevel = \.accurate/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /request\.recognitionLevel = \.accurate/);
  assert.match(cameraModelSwiftSource, /"Wireless Controller"/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /"Wireless Controller"/);
  assert.match(cameraModelSwiftSource, /private let recognitionInterval: Duration = \.milliseconds\(500\)/);
  assert.match(cameraModelSwiftSource, /let candidates = Self\.candidates\(from: observations\)/);
  assert.match(cameraModelSwiftSource, /try\? text\.boundingBox\(for: match\.range\)/);
  assert.doesNotMatch(cameraModelSwiftSource, /layerRectConverted\(fromMetadataOutputRect:/);
});

test("native pre-capture identifier matching is deterministic", () => {
  assert.match(scannerRecognitionModelsSwiftSource, /enum LiveTextCandidateKind: String, Equatable/);
  assert.match(scannerRecognitionModelsSwiftSource, /case imei = "IMEI"/);
  assert.match(scannerRecognitionModelsSwiftSource, /case model = "Model"/);
  assert.match(scannerRecognitionModelsSwiftSource, /case serial = "Serial"/);
  assert.match(scannerRecognitionModelsSwiftSource, /case sku = "SKU"/);
  assert.match(scannerRecognitionModelsSwiftSource, /enum LiveTextIdentifierMatcher/);
  assert.match(scannerRecognitionModelsSwiftSource, /struct Match \{[\s\S]*let range: Range<String\.Index>/);
  assert.match(scannerRecognitionModelsSwiftSource, /guard text\.localizedCaseInsensitiveContains\("imei"\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /guard isValidLuhn\(candidate\) else \{ continue \}/);
  assert.match(scannerRecognitionModelsSwiftSource, /serialLabels = \["serial number", "serial no", "serial", "s\/n", "s\/ n", "s n", "s\. n\.", "sn"\]/);
  assert.match(scannerRecognitionModelsSwiftSource, /modelLabels = \["model number", "model no", "model", "mdl"\]/);
  assert.match(scannerRecognitionModelsSwiftSource, /skuLabels = \["sku", "stock keeping unit"\]/);
  assert.match(scannerRecognitionModelsSwiftSource, /private static func standaloneIdentifier\(in text: String\) -> Match\?/);
  assert.match(scannerRecognitionModelsSwiftSource, /private static func modelTokenCandidate\(in text: String\) -> \(value: String, range: Range<String\.Index>\)\?/);
  assert.match(scannerRecognitionModelsSwiftSource, /combinedModelToken\(prefix: candidate\.value, suffix: next\.value\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /uppercased\.hasPrefix\("CF1"\) \|\| uppercased\.hasPrefix\("CFL"\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /uppercased\.hasPrefix\("CFI"\) && !uppercased\.hasPrefix\("CFI-"\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /isKnownModelToken\(\$0\.value\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /isLikelySerialToken\(\$0\.value\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /static func labelKind\(in rawText: String\) -> LiveTextCandidateKind\?/);
  assert.match(scannerRecognitionModelsSwiftSource, /static func standaloneValue\(in rawText: String, kind: LiveTextCandidateKind\) -> String\?/);
  assert.match(scannerRecognitionModelsSwiftSource, /private static func labelRange\(in text: String, label: String\) -> Range<String\.Index>\?/);
  assert.match(scannerRecognitionModelsSwiftSource, /isLabelBoundary\(in: text, before: range\.lowerBound\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /isLabelBoundary\(in: text, after: range\.upperBound\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /text\[valueStart\.\.\.\]\.range\(of: cleaned\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /normalizedAppleRetailPartToken\(candidate\.value\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /return match\(kind: \.serial, value: serial\.value, range: serial\.range\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /Match\(kind: kind, value: normalizedIdentifierValue\(value, kind: kind\), range: range\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /case \.serial:\s*return replacingAmbiguousZeros\(in: value\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /uppercased\.hasSuffix\("OC"\) \|\| uppercased\.hasSuffix\("OG"\)/);
});

test("native pre-capture identifiers render in the fixed top status area", () => {
  assert.match(scannerCameraLayerSwiftSource, /store\.camera\.setLiveTextScanningEnabled\(store\.activeMode == \.ocr\)/);
  assert.match(scannerCameraLayerSwiftSource, /\.onDisappear \{\s*store\.camera\.setLiveTextScanningEnabled\(false\)\s*\}/);
  assert.doesNotMatch(scannerCameraLayerSwiftSource, /LiveTextCandidateReticle/);
  assert.match(captureSessionViewSwiftSource, /CameraSessionTopStatus\([\s\S]*liveTextCandidates: store\.camera\.liveTextCandidates,[\s\S]*store\.sendRecognizedText\(candidate\.value\)/);
  assert.match(sharedCameraSessionControlsSwiftSource, /struct CameraSessionTopStatus: View[\s\S]*var liveTextCandidates: \[LiveTextCandidate\] = \[\]/);
  assert.match(sharedCameraSessionControlsSwiftSource, /activeMode == \.ocr, !liveTextCandidates\.isEmpty[\s\S]*LiveIdentifierStrip\(/);
  assert.match(cameraSessionControlsSwiftSource, /struct LiveIdentifierStrip: View/);
  assert.match(cameraSessionControlsSwiftSource, /let onSend: \(LiveTextCandidate\) -> Void/);
  assert.match(cameraSessionControlsSwiftSource, /struct LiveIdentifierChip: View/);
  assert.match(sharedCameraSessionControlsSwiftSource, /"Frame device identifiers"/);
  assert.doesNotMatch(captureSessionViewSwiftSource, /safeAreaInset\(edge: \.bottom[\s\S]*LiveIdentifierStrip/);
  assert.match(cameraSessionControlsSwiftSource, /Button\(action: onSend\)/);
  assert.match(cameraSessionControlsSwiftSource, /\.background\(Color\.green, in: Capsule\(\)\)/);
});

test("native pre-capture identifier chips show quickly and correct repeated replacements", () => {
  assert.match(cameraModelSwiftSource, /private var liveTextReplacementObservationCounts: \[String: Int\] = \[:\]/);
  assert.match(cameraModelSwiftSource, /private var liveTextEmptyObservationCount = 0/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /private var liveTextEmptyObservationCount = 0/);
  assert.match(cameraModelSwiftSource, /var acceptedCandidates = liveTextCandidates/);
  assert.match(cameraModelSwiftSource, /hasLiveTextCandidate\(candidate, in: acceptedCandidates\)/);
  assert.match(cameraModelSwiftSource, /replacementIndex\(for: candidate, in: acceptedCandidates\)/);
  assert.match(cameraModelSwiftSource, /shouldReplaceLiveTextCandidate\(candidate, replacing: acceptedCandidates\[replacementIndex\]\)/);
  assert.match(cameraModelSwiftSource, /case \.imei:\s*return existingKindCount < 2/);
  assert.match(cameraModelSwiftSource, /case \.model, \.serial, \.sku:\s*return existingKindCount < 1/);
  assert.match(cameraModelSwiftSource, /guard !candidates\.isEmpty else \{\s*liveTextEmptyObservationCount \+= 1\s*if liveTextEmptyObservationCount >= 3/);
  assert.match(cameraModelSwiftSource, /liveTextEmptyObservationCount = 0\s*var acceptedCandidates = liveTextCandidates/);
  assert.match(cameraModelSwiftSource, /request\.minimumTextHeight = 0\.006/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /request\.minimumTextHeight = 0\.006/);
  assert.match(cameraModelSwiftSource, /"CFI-ZCT1W"/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /"CFI-ZCT1W"/);
  assert.match(scannerRecognitionModelsSwiftSource, /enum LiveTextCandidateObservationExtractor/);
  assert.match(scannerRecognitionModelsSwiftSource, /labelAnchoredRowCandidates\(in: snapshots\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /denseRowCandidates\(in: snapshots\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /isSameTextRow\(/);
  assert.match(scannerRecognitionModelsSwiftSource, /max\(0\.035, heightTolerance\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /let combinedText = rowWindow\.map\(\\\.text\)\.joined\(separator: " "\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /LiveTextIdentifierMatcher\.match\(combinedText, allowingStandalone: false\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /unionBoundingBox\(for: rowWindow\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /adjacentLabelValueCandidates\(in: snapshots\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /LiveTextIdentifierMatcher\.labelKind\(in: label\.text\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /LiveTextIdentifierMatcher\.standaloneValue\(in: value\.text, kind: kind\)/);
  assert.match(cameraModelSwiftSource, /LiveTextCandidateObservationExtractor\.prioritizedCandidates/);
  assert.match(clipBarcodeScannerServiceSwiftSource, /LiveTextCandidateObservationExtractor\.prioritizedCandidates/);
  assert.match(cameraModelSwiftSource, /guard observationCount >= 2 else \{ return false \}/);
  assert.match(cameraModelSwiftSource, /observationCount >= 3/);
});

test("native post-capture OCR extracts device identifiers from recognized rows", () => {
  assert.match(scannerRecognitionModelsSwiftSource, /enum DeviceIdentifierRegionExtractor/);
  assert.match(scannerRecognitionModelsSwiftSource, /regions\.filter\(\\\.isDeviceIdentifier\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /identifierRegion\(from: \$0, allowingStandalone: false\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /identifierRegion\(from: \$0, allowingStandalone: true\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /LiveTextIdentifierMatcher\.match\(region\.text, allowingStandalone: allowingStandalone\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /text: match\.value/);
  assert.match(textRecognizerSwiftSource, /if let match = LiveTextIdentifierMatcher\.match\(trimmed\)/);
  assert.match(textRecognizerSwiftSource, /let matchedGlyphs = Self\.glyphs\(in: match\.range, text: trimmed, glyphs: glyphs\)/);
  assert.match(textRecognizerSwiftSource, /appendGlyphRegion\([\s\S]*text: match\.value[\s\S]*isDeviceIdentifier: true/);
  assert.match(scannerRecognitionModelsSwiftSource, /let isDeviceIdentifier: Bool/);
  assert.match(ocrReviewLayerSwiftSource, /region\.isDeviceIdentifier \? \.green\.opacity\(0\.24\) : \.yellow\.opacity\(0\.24\)/);
  assert.match(ocrReviewLayerSwiftSource, /region\.isDeviceIdentifier \? \.green\.opacity\(0\.9\) : \.yellow\.opacity\(0\.9\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /return identifierRegions\.isEmpty \? regions : deduplicated\(identifierRegions\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /static func reviewRegions\(from regions: \[RecognizedTextRegion\]\) -> \[RecognizedTextRegion\]/);
  assert.match(scannerRecognitionModelsSwiftSource, /guard !containsEquivalentText\(region, in: reviewRegions\) else \{ continue \}/);
  assert.match(ocrReviewLayerSwiftSource, /Button\("Copy", systemImage: "doc\.on\.doc"\)/);
  assert.match(scannerRecognitionModelsSwiftSource, /private static let regulatoryLabels = \[/);
  assert.match(scannerRecognitionModelsSwiftSource, /"cnc id"/);
  assert.match(scannerRecognitionModelsSwiftSource, /"conatel"/);
  assert.match(scannerRecognitionModelsSwiftSource, /"anatel"/);
  assert.match(scannerRecognitionModelsSwiftSource, /guard !isRegulatoryIdentifierContext\(text\) else \{ return nil \}/);
  assert.match(scannerStoreCaptureActionsSwiftSource, /DeviceIdentifierRegionExtractor\.reviewRegions\(from: recognizedRegions\)/);
});

test("native OCR target dialog defaults to cleaned text and can reveal raw text", () => {
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /Button\(action: onSend\) \{[\s\S]*Label\("Send", systemImage: "paperplane\.fill"\)/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /let onToggleRepresentation: \(\) -> Void/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /Label\(isShowingRaw \? "Cleaned" : "Raw"/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /Label\("Cleaning…", systemImage: "wand\.and\.sparkles"\)/);
  assert.match(captureSessionViewSwiftSource, /store\.sendRecognizedText\(selectedTextValue\)/);
  assert.match(captureSessionViewSwiftSource, /selectTextRegion\(_ region: RecognizedTextRegion\) \{\s*resetSelectedText\(\)\s*selectedTextRegion = region\s*cleanupSelectedText\(region\)/);
  assert.match(captureSessionViewSwiftSource, /OcrTextCleaner\.clean\(text: region\.text, context: context\)/);
  assert.match(captureSessionViewSwiftSource, /guard cleanupRequestID == requestID,[\s\S]*selectedTextRegion\?\.id == region\.id/);
  assert.match(captureSessionViewSwiftSource, /private func resetSelectedText\(\)/);
  assert.match(sharedCaptureSessionOverlaysSwiftSource, /Button\(action: onDismiss\) \{[\s\S]*Image\(systemName: "xmark"\)/);
  assert.match(captureSessionViewSwiftSource, /private var selectedTextPreview: String/);
});
