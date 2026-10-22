/**
 * Hovering a UPC highlighted by upc-highlighter.ts (.volt-upc-highlight) opens
 * the selection pill with UPC actions. A short open delay keeps a mouse sweep
 * across a page of UPCs from flashing menus; a close delay lets the pointer
 * cross the gap into the pill.
 */
type UpcHoverMenuOptions = {
  /** Checked when the open delay ends, so a menu or disabled setting wins. */
  canShow: () => boolean;
  show: (element: Element, upc: string, onPillHoverChange: (hovered: boolean) => void) => void;
  close: () => void;
};

export function installUpcHoverMenu(root: EventTarget, { canShow, show, close }: UpcHoverMenuOptions) {
  let hoveredUpcElement: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const setTimer = (callback: () => void, delay: number) => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, delay);
  };
  const leave = () => {
    setTimer(() => {
      if (hoveredUpcElement) close();
    }, 250);
  };
  const open = (element: Element) => {
    const upc = element.getAttribute("data-upc");
    if (!upc || !element.isConnected || !canShow()) return;
    show(element, upc, (hovered) => {
      if (hovered) clearTimer();
      else leave();
    });
    hoveredUpcElement = element;
  };
  const upcTarget = (event: Event) =>
    event.target instanceof Element ? event.target.closest(".volt-upc-highlight") : null;

  root.addEventListener(
    "mouseover",
    (event) => {
      const upcElement = upcTarget(event);
      if (!upcElement) return;
      if (upcElement === hoveredUpcElement) {
        clearTimer();
        return;
      }
      setTimer(() => open(upcElement), 150);
    },
    true,
  );
  root.addEventListener(
    "mouseout",
    (event) => {
      const upcElement = upcTarget(event);
      if (!upcElement) return;
      const relatedTarget = (event as MouseEvent).relatedTarget;
      if (relatedTarget instanceof Node && upcElement.contains(relatedTarget)) return;
      if (upcElement === hoveredUpcElement) leave();
      else clearTimer();
    },
    true,
  );

  return {
    /** The pill closed for any reason, so no UPC owns it any more. */
    pillClosed: () => {
      hoveredUpcElement = null;
    },
  };
}
