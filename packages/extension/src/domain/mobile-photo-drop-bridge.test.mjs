import assert from "node:assert/strict";
import { File as NodeFile } from "node:buffer";
import test from "node:test";

import {
  installPhotoDropBridge,
} from "../components/sidepanel/mobile-photo-helpers.ts";
import { PHOTO_DROP_MIME } from "./mobile-photo.ts";

test("photo drop bridge reaches Shopify media inputs inside shadow DOM", async () => {
  const listeners = new Map();

  class FakeElement {
    constructor() {
      this.events = [];
      this.nestedInput = null;
    }

    closest(selector) {
      return selector === "input[type='file']" && this instanceof FakeInput
        ? this
        : null;
    }

    dispatchEvent(event) {
      this.events.push(event.type);
      return true;
    }

    getAttribute() {
      return null;
    }

    querySelector() {
      return this.nestedInput;
    }
  }

  class FakeInput extends FakeElement {
    constructor() {
      super();
      this.accept = "image/jpeg,image/png";
      this.files = [];
      this.id = "file-input";
      this.multiple = true;
      this.name = "";
      this.type = "file";
    }
  }

  class FakeDataTransfer {
    constructor() {
      this.files = [];
      this.items = {
        add: (file) => this.files.push(file),
      };
    }
  }

  class FakeDragEvent {
    constructor(type, options) {
      this.type = type;
      Object.assign(this, options);
    }
  }

  const mediaInput = new FakeInput();
  const shadowDropZone = new FakeElement();
  shadowDropZone.nestedInput = mediaInput;
  const shadowHost = new FakeElement();
  const fakeDocument = {
    activeElement: null,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    body: new FakeElement(),
    querySelectorAll() {
      return [];
    },
  };
  const fakeWindow = {
    getComputedStyle() {
      return { display: "block", visibility: "visible" };
    },
  };
  const globals = {
    DataTransfer: FakeDataTransfer,
    DragEvent: FakeDragEvent,
    Element: FakeElement,
    File: NodeFile,
    HTMLInputElement: FakeInput,
    document: fakeDocument,
    location: { hostname: "example.com" },
    window: fakeWindow,
  };
  const originalDescriptors = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );

  try {
    Object.entries(globals).forEach(([key, value]) => {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value,
        writable: true,
      });
    });

    installPhotoDropBridge(PHOTO_DROP_MIME);
    const dropListener = listeners.get("drop");
    assert.equal(typeof dropListener, "function");

    const payload = JSON.stringify([
      {
        dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
        mimeType: "image/jpeg",
        name: "listing-photo.jpg",
      },
    ]);
    await dropListener({
      composedPath: () => [shadowDropZone, shadowHost],
      dataTransfer: {
        getData: (type) => (type === PHOTO_DROP_MIME ? payload : ""),
      },
      preventDefault() {},
      stopImmediatePropagation() {},
      stopPropagation() {},
      target: shadowHost,
    });

    assert.equal(mediaInput.files.length, 1);
    assert.equal(mediaInput.files[0].name, "listing-photo.jpg");
    assert.equal(mediaInput.files[0].type, "image/jpeg");
  } finally {
    originalDescriptors.forEach((descriptor, key) => {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    });
  }
});
