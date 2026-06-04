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

test("cropActionForVisibleFrame can tighten the captured region for wider iOS still output", () => {
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
        captureScale: 0.56,
      }
    ),
    {
      crop: {
        originX: 933,
        originY: 547,
        width: 1132,
        height: 1132,
      },
    }
  );
});

test("photo capture uses measured camera and frame layout before sending", () => {
  const photosTab = readFileSync(new URL("../app/(tabs)/photos.tsx", import.meta.url), "utf8");

  assert.match(photosTab, /const \[cameraLayout, setCameraLayout\]/);
  assert.match(photosTab, /const \[photoFrameLayout, setPhotoFrameLayout\]/);
  assert.match(photosTab, /previewWidth: cameraLayout\.width/);
  assert.match(photosTab, /frameX: photoFrameLayout\.x/);
  assert.match(photosTab, /captureScale: Platform\.OS === "ios" \? iosExpoPreviewCaptureScale : 1/);
  assert.match(photosTab, /onLayout=\{handleCameraLayout\}/);
  assert.match(photosTab, /onFrameLayout=\{handlePhotoFrameLayout\}/);
  assert.match(photosTab, /disabled=\{scanner\.photoSending \|\| !photoCropFrame\}/);
});
