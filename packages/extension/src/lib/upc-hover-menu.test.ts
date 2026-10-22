import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installUpcHoverMenu } from "./upc-hover-menu";

class FakeElement {
  isConnected = true;
  constructor(private readonly upc: string) {}
  getAttribute(name: string) {
    return name === "data-upc" ? this.upc : null;
  }
  closest() {
    return this;
  }
  contains(other: unknown) {
    return other === this;
  }
}

function pointer(root: EventTarget, type: "mouseover" | "mouseout", target: FakeElement) {
  const event = new Event(type);
  Object.defineProperty(event, "target", { value: target });
  Object.defineProperty(event, "relatedTarget", { value: null });
  root.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("Node", FakeElement);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(enabled: { value: boolean }) {
  const root = new EventTarget();
  const show = vi.fn();
  const close = vi.fn();
  const menu = installUpcHoverMenu(root, { canShow: () => enabled.value, show, close });
  return { root, show, close, menu };
}

test("hovering a UPC opens the pill after the delay and leaving closes it", () => {
  const { root, show, close } = setup({ value: true });
  const upc = new FakeElement("012345678905");
  pointer(root, "mouseover", upc);
  expect(show).not.toHaveBeenCalled();
  vi.advanceTimersByTime(150);
  expect(show).toHaveBeenCalledWith(upc, "012345678905", expect.any(Function));

  pointer(root, "mouseout", upc);
  vi.advanceTimersByTime(250);
  expect(close).toHaveBeenCalledTimes(1);
});

test("a hover pending when suggestions are disabled never opens the pill", () => {
  const enabled = { value: true };
  const { root, show } = setup(enabled);
  pointer(root, "mouseover", new FakeElement("012345678905"));
  enabled.value = false;
  vi.advanceTimersByTime(150);
  expect(show).not.toHaveBeenCalled();
});

test("moving into the pill keeps it open", () => {
  const { root, show, close } = setup({ value: true });
  const upc = new FakeElement("012345678905");
  pointer(root, "mouseover", upc);
  vi.advanceTimersByTime(150);
  const onPillHoverChange = show.mock.calls[0][2] as (hovered: boolean) => void;

  pointer(root, "mouseout", upc);
  onPillHoverChange(true);
  vi.advanceTimersByTime(1000);
  expect(close).not.toHaveBeenCalled();

  onPillHoverChange(false);
  vi.advanceTimersByTime(250);
  expect(close).toHaveBeenCalledTimes(1);
});
