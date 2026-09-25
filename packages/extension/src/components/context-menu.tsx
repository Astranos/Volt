import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

export type MenuAction = {
  id: string;
  label: string;
  shortcut?: string;
  description?: string;
  icon?: React.ComponentType<{ size?: number }>;
  requiresSelection?: boolean;
  requiresUrl?: boolean;
  onInvoke: (ctx: { x: number; y: number; selection: string }) => void;
  getUrl?: (selection: string) => string;
};

type ContextMenuProps = {
  actions: MenuAction[];
  selectionActionCount: number;
  quickActions: MenuAction[];
  lastSelection: string;
  clickedUrl: string | null;
  x: number;
  y: number;
  closeMenu: (options?: { restoreFocus?: boolean }) => void;
  openUrl: (url: string) => void;
  dismiss: () => void;
};

export function ContextMenu({ actions, selectionActionCount, quickActions, lastSelection, clickedUrl, x, y, closeMenu, openUrl, dismiss }: ContextMenuProps) {
  const items = actions;
  const hasSelection = !!lastSelection;
  const menuRef = useRef<HTMLDivElement>(null);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (item.requiresUrl && !clickedUrl) return false;
      return true;
    });
  }, [items, clickedUrl]);

  const enabledItems = useMemo(
    () =>
      visibleItems.filter(
        (item) => !(item.requiresSelection && !hasSelection),
      ),
    [hasSelection, visibleItems],
  );

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex((current) =>
      Math.min(current, Math.max(0, enabledItems.length - 1)),
    );
  }, [enabledItems.length]);

  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { height, width } = menu.getBoundingClientRect();
    const left = Math.min(Math.max(x, 8), Math.max(8, vw - width - 8));
    const top = Math.min(Math.max(y, 8), Math.max(8, vh - height - 8));
    setPos({ left, top });
  }, [hasSelection, visibleItems.length, x, y]);

  useEffect(() => {
    const handle = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeMenu();
        return;
      }
      if (enabledItems.length === 0) return;

      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        setIndex((i) => (i + 1) % enabledItems.length);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        setIndex(
          (i) => (i - 1 + enabledItems.length) % enabledItems.length
        );
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        const item = enabledItems[index];
        if (item) {
          try {
            item.onInvoke({ x, y, selection: lastSelection });
          } catch (_) {}
          closeMenu({ restoreFocus: false });
        }
      } else {
        // Check for letter shortcuts
        const key = ev.key.toUpperCase();
        const matchingItem = enabledItems.find(
          (item) => item.shortcut?.toUpperCase() === key
        );
        if (matchingItem) {
          ev.preventDefault();
          try {
            matchingItem.onInvoke({ x, y, selection: lastSelection });
          } catch (_) {}
          closeMenu({ restoreFocus: false });
        }
      }
    };
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, [enabledItems, index, closeMenu, x, y, lastSelection]);

  const onOverlayClick = (e: React.MouseEvent) => {
    const el = e.nativeEvent.composedPath()[0];
    if (!(el instanceof Element && el.closest(".menu"))) closeMenu();
  };

  const onItemClick = (item: MenuAction) => {
    try {
      item.onInvoke({ x, y, selection: lastSelection });
    } catch (_) {}
    closeMenu({ restoreFocus: false });
  };

  const onQuickActionClick = (action: MenuAction) => {
    if (action.requiresSelection && !hasSelection) return;
    if (action.requiresUrl && !clickedUrl) return;
    try {
      action.onInvoke({ x, y, selection: lastSelection });
    } catch (_) {}
    closeMenu({ restoreFocus: false });
  };

  const onDismiss = () => {
    dismiss();
    closeMenu();
  };

  return (
    <div
      className="overlay"
      onClick={onOverlayClick}
      onContextMenu={(ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      }}
    >
      <div
        ref={menuRef}
        className="menu"
        style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      >
        <div className="hdr">
          <span>Volt</span>
          <button className="dismiss-btn" onClick={onDismiss} type="button">
            Dismiss Menu
          </button>
        </div>
        <div className="quick-actions">
          {quickActions.map((action) => {
            const disabled =
              (action.requiresSelection && !hasSelection) ||
              (action.requiresUrl && !clickedUrl);
            return (
              <div
                key={action.id}
                className="icon-btn-wrapper"
              >
                <button
                  aria-label={action.label}
                  className="icon-btn"
                  disabled={disabled}
                  onClick={() => onQuickActionClick(action)}
                  title={action.label}
                  type="button"
                >
                  {action.icon && <action.icon size={16} />}
                </button>
                <div className="tooltip">{action.label}</div>
              </div>
            );
          })}
        </div>
        {hasSelection ? (
          <div className="selection-context" title={lastSelection}>
            <span className="selection-context-label">Selected</span>
            <span className="selection-context-value">
              “{lastSelection}”
            </span>
          </div>
        ) : (
          <div className="empty-hint">Select text for search actions</div>
        )}
        <div className="group">
          {visibleItems.length === 0 && hasSelection && (
            <div className="empty-hint">No matching actions</div>
          )}
          {visibleItems.map((item, i) => {
            const enabledIndex = enabledItems.indexOf(item);
            return (
              <React.Fragment key={item.id}>
                {i === 0 && selectionActionCount > 0 && (
                  <div className="section-label">Search selected text</div>
                )}
                {i === selectionActionCount && (
                  <>
                    {selectionActionCount > 0 && <div className="sep" />}
                    <div className="section-label">Tools</div>
                  </>
                )}
                <div
                  aria-disabled={item.requiresSelection && !hasSelection}
                  className={`item ${
                    item.requiresSelection && !hasSelection ? "disabled" : ""
                  }`}
                  tabIndex={-1}
                  data-active={enabledIndex === index}
                  onClick={() => {
                    if (item.requiresSelection && !hasSelection) return;
                    onItemClick(item);
                  }}
                  onMouseEnter={() => {
                    if (enabledIndex >= 0) setIndex(enabledIndex);
                  }}
                >
                  <div className="icon">
                    {item.icon && <item.icon size={16} />}
                  </div>
                  <div className="label">{item.label}</div>
                  {item.getUrl && hasSelection && (
                    <button
                      aria-label={`Open ${item.label} in new tab`}
                      className="new-tab-btn"
                      title="Open in New Tab"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openUrl(item.getUrl!(lastSelection));
                        closeMenu({ restoreFocus: false });
                      }}
                    >
                      <ExternalLink size={14} />
                    </button>
                  )}
                  {item.shortcut && (
                    <div className="shortcut">{item.shortcut}</div>
                  )}
                  <div className="item-tooltip">{item.description}</div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
