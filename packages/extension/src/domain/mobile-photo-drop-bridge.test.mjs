import assert from "node:assert/strict";
import { File as NodeFile } from "node:buffer";
import test from "node:test";

import {
  insertPhotosIntoPage,
  installPhotoDropBridge,
} from "../components/sidepanel/mobile-photo-helpers.ts";
import { PHOTO_DROP_MIME } from "./mobile-photo.ts";

test("photo drop bridge reaches Shopify media inputs inside shadow DOM", async () => {
  const listeners = new Map();

  class FakeElement {
    constructor() {
      this.events = [];
      this.dropContainer = null;
      this.nestedInput = null;
      this.shadowRoot = null;
    }

    closest(selector) {
      if (selector === "input[type='file']" && this instanceof FakeInput) {
        return this;
      }
      return selector.includes("[data-polaris-dropzone]")
        ? this.dropContainer
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

    getRootNode() {
      return fakeDocument;
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
  mediaInput.dropContainer = shadowDropZone;
  const slottedDropContent = new FakeElement();
  const shadowHost = new FakeElement();
  shadowHost.shadowRoot = {
    querySelector(selector) {
      return selector === "input[type='file']" ? mediaInput : null;
    },
    querySelectorAll(selector) {
      if (selector === "input[type='file']") return [mediaInput];
      return [];
    },
  };
  const fakeDocument = {
    activeElement: null,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    body: new FakeElement(),
    querySelectorAll(selector) {
      if (selector === "*") return [shadowHost];
      return [];
    },
  };
  let previousBridgeCleanupCount = 0;
  const fakeWindow = {
    __voltPhotoDropBridgeCleanup() {
      previousBridgeCleanupCount += 1;
    },
    __voltPhotoDropBridgeVersion: 8,
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
    assert.equal(previousBridgeCleanupCount, 1);
    const dragEnterListener = listeners.get("dragenter");
    assert.equal(typeof dragEnterListener, "function");
    const hoverCalls = [];
    const hoverTransfer = {
      dropEffect: "none",
      types: [PHOTO_DROP_MIME],
    };
    dragEnterListener({
      dataTransfer: hoverTransfer,
      preventDefault: () => hoverCalls.push("preventDefault"),
      stopImmediatePropagation: () =>
        hoverCalls.push("stopImmediatePropagation"),
      stopPropagation: () => hoverCalls.push("stopPropagation"),
    });
    assert.deepEqual(hoverCalls, [
      "preventDefault",
      "stopPropagation",
      "stopImmediatePropagation",
    ]);
    assert.equal(hoverTransfer.dropEffect, "copy");

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
      composedPath: () => [slottedDropContent, shadowHost],
      dataTransfer: {
        getData: (type) => (type === PHOTO_DROP_MIME ? payload : ""),
      },
      preventDefault() {},
      stopImmediatePropagation() {},
      stopPropagation() {},
      target: shadowHost,
    });

    assert.equal(mediaInput.files.length, 0);
    assert.deepEqual(mediaInput.events, []);
    assert.deepEqual(shadowDropZone.events, ["dragenter", "dragover", "drop"]);
    assert.deepEqual(shadowHost.events, []);
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

test("photo insertion reaches media inputs inside shadow DOM", async () => {
  class FakeElement {
    constructor() {
      this.events = [];
      this.dropContainer = null;
      this.shadowRoot = null;
    }

    closest(selector) {
      if (selector === "input[type='file']" && this instanceof FakeInput) {
        return this;
      }
      return selector.includes("[data-polaris-dropzone]")
        ? this.dropContainer
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
      return null;
    }

    getRootNode() {
      return fakeDocument;
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
  mediaInput.dropContainer = shadowDropZone;
  class FakeShadowRoot {
    constructor(host) {
      this.host = host;
    }

    querySelectorAll(selector) {
      if (selector === "input[type='file']") return [mediaInput];
      return [];
    }
  }
  const shadowHost = new FakeElement();
  const mediaShadowRoot = new FakeShadowRoot(shadowHost);
  shadowHost.shadowRoot = mediaShadowRoot;
  mediaInput.getRootNode = () => mediaShadowRoot;
  const outerShadowHost = new FakeElement();
  outerShadowHost.shadowRoot = {
    querySelectorAll(selector) {
      if (selector === "*") return [shadowHost];
      return [];
    },
  };
  const fakeDocument = {
    activeElement: null,
    body: new FakeElement(),
    querySelectorAll(selector) {
      if (selector === "*") return [outerShadowHost];
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

    const result = await insertPhotosIntoPage([
      {
        dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
        mimeType: "image/jpeg",
        name: "listing-photo.jpg",
      },
    ]);

    assert.deepEqual(result, { inserted: true, count: 1 });
    assert.equal(mediaInput.files.length, 0);
    assert.deepEqual(mediaInput.events, []);
    assert.deepEqual(shadowDropZone.events, ["dragenter", "dragover", "drop"]);
    assert.deepEqual(shadowHost.events, []);
    assert.deepEqual(fakeDocument.body.events, []);
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
