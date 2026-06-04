import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { centerSquareCropAction, cropActionForVisibleFrame } from "./photo-crop.ts";

test("cropActionForVisibleFrame maps an offset viewfinder square through covered preview geometry", () => {
  assert.deepEqual(
    cropActionForVisibleFrame(
      { width: 3000, height: 4000 },
      {
        previewWidth: 390,
        previewHeight: 700,
        frameX: 18,
        frameY: 18,
        frameWidth: 354,
        frameHeight: 354,
      }
    ),
    {
      crop: {
        originX: 488,
        originY: 102,
        width: 2022,
        height: 2022,
      },
    }
  );
});

test("cropActionForVisibleFrame falls back to a centered square without valid frame geometry", () => {
  assert.deepEqual(cropActionForVisibleFrame({ width: 4032, height: 3024 }, null), centerSquareCropAction({ width: 4032, height: 3024 }));
  assert.deepEqual(centerSquareCropAction({ width: 4032, height: 3024 }), {
    crop: {
      originX: 504,
      originY: 0,
      width: 3024,
      height: 3024,
    },
  });
});

test("Expo photo fallback uses measured camera and frame layout before sending", () => {
  const photosTab = readFileSync(new URL("../app/(tabs)/photos.tsx", import.meta.url), "utf8");

  assert.match(photosTab, /const \[cameraLayout, setCameraLayout\]/);
  assert.match(photosTab, /const \[photoFrameLayout, setPhotoFrameLayout\]/);
  assert.match(photosTab, /previewWidth: cameraLayout\.width/);
  assert.match(photosTab, /frameX: photoFrameLayout\.x/);
  assert.doesNotMatch(photosTab, /iosExpoPreviewCaptureScale/);
  assert.doesNotMatch(photosTab, /captureScale:/);
  assert.match(photosTab, /onLayout=\{handleCameraLayout\}/);
  assert.match(photosTab, /onFrameLayout=\{handlePhotoFrameLayout\}/);
  assert.match(photosTab, /const photoCaptureReady = useNativePhotoCamera \? photoFrameSize > 0 : !!photoCropFrame/);
  assert.match(photosTab, /disabled=\{scanner\.photoSending \|\| !photoCaptureReady\}/);
  assert.match(photosTab, /scanner\.sendPhotoCapture\(useNativePhotoCamera \? null : photoCropFrame\)/);
});
