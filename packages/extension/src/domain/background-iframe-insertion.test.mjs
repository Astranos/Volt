import assert from "node:assert/strict";
import test from "node:test";

import {
  createScannerTextInserter,
  insertTextAtTrackedEditableFromBackground,
} from "../background/scanner-text-insertion.ts";
import { createMobileCaptureTargetController } from "../background/mobile-capture-targets.ts";

test("scanner text insertion targets the tracked iframe when the cursor is inside one", async () => {
  const executeCalls = [];
  const inserter = createScannerTextInserter({
    chromeApi: {
      tabs: { query: async () => [{ id: 42 }] },
      scripting: {
        executeScript: async (call) => {
          executeCalls.push(call);
          return [{ result: { inserted: true } }];
        },
      },
    },
    log: () => {},
    getTrackedTarget: () => ({ frameId: 7, cursor: "Description" }),
    copyWithOffscreen: async () => {
      throw new Error("clipboard fallback should not run");
    },
  });

  const inserted = await inserter.insertScannerText("hello");

  assert.equal(inserted, true);
  assert.equal(executeCalls.length, 1);
  assert.deepEqual(executeCalls[0].target, { tabId: 42, frameIds: [7] });
});

test("scanner text insertion falls back to the main frame if tracked iframe injection fails", async () => {
  const executeCalls = [];
  const logs = [];
  const inserter = createScannerTextInserter({
    chromeApi: {
      tabs: { query: async () => [{ id: 42 }] },
      scripting: {
        executeScript: async (call) => {
          executeCalls.push(call);
          if (executeCalls.length === 1) throw new Error("frame gone");
          return [{ result: { inserted: true } }];
        },
      },
    },
    log: (...args) => logs.push(args),
    getTrackedTarget: () => ({ frameId: 7, cursor: "Description" }),
    copyWithOffscreen: async () => {
      throw new Error("clipboard fallback should not run");
    },
  });

  const inserted = await inserter.insertScannerText("hello");

  assert.equal(inserted, true);
  assert.deepEqual(executeCalls.map((call) => call.target), [
    { tabId: 42, frameIds: [7] },
    { tabId: 42 },
  ]);
  assert.equal(logs[0][0], "scanner frame insert fallback");
});

test("mobile capture target tracking preserves sender frame id for later insertion", async () => {
  const offscreenMessages = [];
  const controller = createMobileCaptureTargetController({
    chromeApi: {
      tabs: {
        query: async () => [
          { id: 42, title: "Product page", url: "https://example.test/product" },
        ],
      },
    },
    log: () => {},
    sendScannerOffscreenMessage: async (message) => {
      offscreenMessages.push(message);
    },
  });

  await controller.updateMobileCaptureTarget(
    { cursor: "Description", tabTitle: "Old title", url: "https://old.test" },
    { tab: { id: 42 }, frameId: 5 }
  );

  assert.deepEqual(controller.getTrackedTarget(42), {
    browser: "Chrome",
    tabTitle: "Old title",
    url: "https://old.test",
    cursor: "Description",
    frameId: 5,
    updatedAt: controller.getTrackedTarget(42).updatedAt,
  });
  assert.equal(offscreenMessages[0].action, "scannerOffscreenUpdateTarget");

  const activeTarget = await controller.getMobileCaptureTarget();
  assert.equal(activeTarget.frameId, 5);
  assert.equal(activeTarget.tabTitle, "Product page");
  assert.equal(activeTarget.url, "https://example.test/product");
});

test("scanner text insertion supports rich editable documents", () => {
  const events = [];
  const body = installFakeDom({ tagName: "BODY", isContentEditable: false, events });
  globalThis.document.designMode = "on";
  globalThis.document.body = body;

  const result = insertTextAtTrackedEditableFromBackground("rich text");

  assert.deepEqual(result, { inserted: true });
  assert.deepEqual(globalThis.document.execCommands, [["insertText", false, "rich text"]]);
  assert.deepEqual(events.map((event) => [event.type, event.inputType, event.composed]), [
    ["beforeinput", "insertText", true],
    ["input", "insertText", true],
    ["change", undefined, true],
  ]);
});

test("scanner text insertion uses native setters and composed input events", () => {
  const events = [];
  const input = installFakeDom({ tagName: "INPUT", value: "abc", events });
  input.selectionStart = 1;
  input.selectionEnd = 2;

  const result = insertTextAtTrackedEditableFromBackground("Z");

  assert.deepEqual(result, { inserted: true });
  assert.equal(input.value, "aZc");
  assert.equal(input.nativeSetterUsed, true);
  assert.deepEqual(events.map((event) => [event.type, event.inputType, event.data, event.composed]), [
    ["beforeinput", "insertText", "Z", true],
    ["input", "insertText", "Z", true],
    ["change", undefined, undefined, true],
  ]);
});

function installFakeDom({ tagName, value = "", isContentEditable = false, events }) {
  class FakeHTMLElement {
    constructor() {
      this.tagName = tagName;
      this.isContentEditable = isContentEditable;
    }

    getAttribute() {
      return null;
    }

    focus() {
      globalThis.document.activeElement = this;
    }

    dispatchEvent(event) {
      events.push(event);
      return true;
    }
  }

  class FakeInputElement extends FakeHTMLElement {
    constructor() {
      super();
      this.selectionStart = value.length;
      this.selectionEnd = value.length;
      this.nativeSetterUsed = false;
      this._value = value;
    }

    get value() {
      return this._value;
    }

    set value(nextValue) {
      this.nativeSetterUsed = true;
      this._value = nextValue;
    }
  }

  class FakeTextAreaElement extends FakeInputElement {}
  class FakeInputEvent {
    constructor(type, init = {}) {
      Object.assign(this, init, { type });
    }
  }
  class FakeEvent {
    constructor(type, init = {}) {
      Object.assign(this, init, { type });
    }
  }

  const element = tagName === "INPUT" ? new FakeInputElement() : new FakeHTMLElement();
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.HTMLInputElement = FakeInputElement;
  globalThis.HTMLTextAreaElement = FakeTextAreaElement;
  globalThis.InputEvent = FakeInputEvent;
  globalThis.Event = FakeEvent;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: { writeText: async () => {} },
    },
  });
  globalThis.window = {
    getSelection: () => null,
  };
  globalThis.document = {
    activeElement: element,
    body: {},
    designMode: "off",
    documentElement: {},
    execCommands: [],
    addEventListener: () => {},
    createRange: () => {
      throw new Error("range should not be needed in this test");
    },
    execCommand: (...args) => {
      globalThis.document.execCommands.push(args);
      return true;
    },
  };

  return element;
}
