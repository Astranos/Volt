/** document.activeElement stops at a shadow host; Shopify's inputs live inside one. */
export function deepActiveElement(doc: Document = document): HTMLElement | null {
  let el = doc.activeElement as HTMLElement | null;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement as HTMLElement;
  return el;
}

const MENU_POINTER_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "auxclick"];

/**
 * Makes a page-level menu host behave like a native context menu: pressing on it
 * keeps focus in the page (popovers such as Shopify's search close on focusout),
 * and its clicks never reach the page's outside-click handlers. Listeners inside
 * the host's shadow root (React) still run first.
 */
export function isolateMenuPointerEvents(host: HTMLElement): void {
  for (const type of MENU_POINTER_EVENTS) {
    host.addEventListener(type, (event) => {
      if (type === "mousedown") event.preventDefault();
      event.stopPropagation();
    });
  }
}
