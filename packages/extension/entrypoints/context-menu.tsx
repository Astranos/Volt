// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */

import { defineContentScript } from "wxt/utils/define-content-script";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { initializeSidePanelContext } from "../src/lib/sidepanel-gesture";
import { buildSearchUrl, SEARCH_URL_TEMPLATES } from "../src/domain/search";
import {
  Search,
  Barcode,
  PackageSearch,
  TrendingUp,
  Copy,
  Clipboard,
  ExternalLink,
  Download,
  Settings,
  ChevronLeft,
  ChevronRight,
  ScanText,
  Mic,
  Smartphone,
} from "lucide-react";

/**
 * Context Menu Content Script
 * - Light theme, rounded, shadowed menu
 * - Keyboard: Up/Down/Enter/Esc
 * - Ctrl+right-click => native menu
 * - Works everywhere including inputs/contentEditable
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  allFrames: true,
  matchAboutBlank: true,
  main() {
    // Initialize side panel context early (only in top frame to avoid spamming from iframes)
    if (window.top === window) {
      initializeSidePanelContext();
    }

    const log = (...args) => {
      try {
        console.log("[Scout CtxMenu]", ...args);
      } catch (_) {}
    };

    // Feature flag from settings
    let enabled = true;
    let dismissedUntilRefresh = false;
    let activePopup: Window | null = null;
    let activePopupOpenedAt = 0;
    const POPUP_OPENING_GRACE_MS = 700;
    try {
      chrome.storage.sync.get(["cmdkSettings"], (result) => {
        const s = result?.cmdkSettings || {};
        enabled = s?.contextMenu?.enabled ?? true;
      });
    } catch (_) {}

    if ((document as any)._scoutCtxMenuInstalled) return;
    (document as any)._scoutCtxMenuInstalled = true;

    type MenuAction = {
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

    type MobileCaptureMode = "ocr" | "barcode" | "dictation";

    const openUrl = (url: string) => {
      try {
        chrome.runtime.sendMessage({ action: "openUrl", url });
      } catch (_) {}
    };

    const openSearchPopup = (url: string) => {
      // Use Chrome's windows API via background script for reliable cross-origin popup management
      // This fixes issues with Google and other sites that have strict COOP headers
      try {
        chrome.runtime.sendMessage({
          action: "openPreviewPopup",
          url,
          x: window.screen.width / 2,
          y: window.screen.height / 2,
        });
      } catch (_) {
        // Fallback to window.open if messaging fails
        if (activePopup && !activePopup.closed) {
          activePopup.close();
        }

        const width = 1100;
        const height = 800;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;

        activePopup = window.open(
          url,
          "scout_search_popup",
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );
        activePopupOpenedAt = Date.now();
      }
    };

    const buildEbaySoldUrl = (q: string) => {
      return buildSearchUrl(SEARCH_URL_TEMPLATES.ebay, q);
    };

    const copyToClipboard = async (text: string) => {
      if (!text) return false;

      const tryNavigatorApi = async () => {
        if (!navigator?.clipboard?.writeText) return false;
        await navigator.clipboard.writeText(text);
        return true;
      };

      const tryExecCommand = () => {
        if (!document?.body) return false;
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);

        textarea.focus();
        textarea.select();
        const success = document.execCommand?.("copy");

        document.body.removeChild(textarea);
        return !!success;
      };

      const tryBackgroundFallback = async () => {
        await new Promise<void>((resolve, reject) => {
          try {
            chrome.runtime.sendMessage(
              { action: "copyToClipboard", text },
              (response) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                  reject(lastError);
                  return;
                }
                if (response?.success === false) {
                  reject(new Error(response.error || "copy_failed"));
                  return;
                }
                resolve();
              }
            );
          } catch (err) {
            reject(err);
          }
        });
        return true;
      };

      const strategies = [
        () =>
          tryNavigatorApi().catch((err) => {
            log("navigator.clipboard.writeText failed", err);
            return false;
          }),
        () => {
          try {
            return tryExecCommand();
          } catch (err) {
            log("document.execCommand copy failed", err);
            return false;
          }
        },
        () =>
          tryBackgroundFallback().catch((err) => {
            log("Background clipboard copy failed", err);
            return false;
          }),
      ];

      for (const strategy of strategies) {
        const result = await strategy();
        if (result) {
          log("Copied text to clipboard");
          return true;
        }
      }

      log("Failed to copy text to clipboard after all strategies");
      return false;
    };

    const readClipboardText = async () => {
      const tryNavigatorApi = async () => {
        if (!navigator?.clipboard?.readText) return "";
        return navigator.clipboard.readText();
      };

      const tryExecCommand = () => {
        if (!document?.body) return "";
        const textarea = document.createElement("textarea");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.focus();
        const success = document.execCommand?.("paste");
        const value = textarea.value || "";
        document.body.removeChild(textarea);
        return success ? value : "";
      };

      const tryBackgroundFallback = async () => {
        const text = await new Promise<string>((resolve, reject) => {
          try {
            chrome.runtime.sendMessage(
              { action: "readFromClipboard" },
              (response) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                  reject(lastError);
                  return;
                }
                if (response?.success === false) {
                  reject(new Error(response.error || "read_failed"));
                  return;
                }
                resolve(response?.text || "");
              }
            );
          } catch (err) {
            reject(err);
          }
        });
        return text;
      };

      const strategies = [
        () =>
          tryNavigatorApi().catch((err) => {
            log("navigator.clipboard.readText failed", err);
            return "";
          }),
        () => {
          try {
            return tryExecCommand();
          } catch (err) {
            log("document.execCommand paste failed", err);
            return "";
          }
        },
        () =>
          tryBackgroundFallback().catch((err) => {
            log("Background clipboard read failed", err);
            return "";
          }),
      ];

      for (const strategy of strategies) {
        const value = await strategy();
        if (value) {
          log("Read text from clipboard");
          return value;
        }
      }

      log("Unable to read clipboard text");
      return "";
    };

    const navigateTab = (direction: "left" | "right") => {
      try {
        chrome.runtime.sendMessage(
          {
            action: direction === "left" ? "previousTab" : "nextTab",
          },
          (response) => {
            if (chrome.runtime.lastError) {
              log("Tab navigation error:", chrome.runtime.lastError);
            }
          }
        );
      } catch (_) {}
    };

    const isEditable = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      return (
        element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.isContentEditable
      );
    };

    const describeEditable = (element: HTMLElement) => {
      const label =
        element.getAttribute("aria-label") ||
        element.getAttribute("placeholder") ||
        element.getAttribute("name") ||
        element.getAttribute("id") ||
        (element.tagName === "TEXTAREA"
          ? "Textarea"
          : element.isContentEditable
            ? "Editable text"
            : "Text input");
      return String(label).slice(0, 120);
    };

    const primeEditableTarget = () => {
      const root = window as typeof window & {
        __voltLastEditable?: HTMLElement | null;
        __voltLastEditableSelection?: {
          start?: number | null;
          end?: number | null;
          isContentEditable?: boolean;
        } | null;
        __voltLastEditableRange?: Range | null;
      };

      const target = isEditable(focusedElementBeforeMenu)
        ? focusedElementBeforeMenu
        : isEditable(clickedElement)
        ? clickedElement
        : isEditable(document.activeElement)
        ? (document.activeElement as HTMLElement)
        : null;

      if (!target) return;

      root.__voltLastEditable = target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        root.__voltLastEditableSelection = {
          start: target.selectionStart,
          end: target.selectionEnd,
          isContentEditable: false,
        };
      } else {
        root.__voltLastEditableSelection = { isContentEditable: true };
        const selection = window.getSelection();
        root.__voltLastEditableRange =
          selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
      }

      return {
        browser: "Chrome",
        tabTitle: document.title || "Current tab",
        url: location.href,
        cursor: describeEditable(target),
        updatedAt: Date.now(),
      };
    };

    const openMobileCapture = (mode: MobileCaptureMode) => {
      const target = primeEditableTarget();
      try {
        chrome.runtime.sendMessage(
          {
            action: "openMobileCapture",
            mode,
            surface: "popup",
            target,
          },
          (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError || response?.success === false) {
              log("Mobile capture start failed", lastError || response?.error);
            }
          }
        );
      } catch (_) {}
    };

    const quickActions: MenuAction[] = [
      {
        id: "copy",
        label: "Copy",
        icon: Copy,
        requiresSelection: true,
        onInvoke: ({ selection }) => selection && copyToClipboard(selection),
      },
      {
        id: "paste",
        label: "Paste",
        icon: Clipboard,
        onInvoke: async () => {
          try {
            const text = await readClipboardText();
            if (!text) {
              log("Paste aborted: clipboard empty or inaccessible");
              return;
            }

            // Try to find the target element in this order:
            // 1. The focused element before menu opened
            // 2. The clicked element
            // 3. The current active element
            let targetEl: HTMLElement | null =
              focusedElementBeforeMenu ||
              clickedElement ||
              (document.activeElement as HTMLElement);

            // If the target is the clicked element but it's not an input,
            // check if it's inside a contentEditable or look for a nearby input
            if (
              targetEl &&
              targetEl.tagName !== "INPUT" &&
              targetEl.tagName !== "TEXTAREA" &&
              !targetEl.isContentEditable
            ) {
              // Check if clicked element is inside a contentEditable
              let parent = targetEl.parentElement;
              while (parent) {
                if (parent.isContentEditable) {
                  targetEl = parent;
                  break;
                }
                parent = parent.parentElement;
              }
            }

            if (
              targetEl &&
              (targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA")
            ) {
              // Handle input and textarea elements
              const input = targetEl as HTMLInputElement | HTMLTextAreaElement;

              // Focus the element first
              input.focus();

              const start = input.selectionStart || 0;
              const end = input.selectionEnd || 0;
              const value = input.value;

              // Insert text at cursor position
              input.value =
                value.substring(0, start) + text + value.substring(end);

              // Set cursor position after inserted text
              const newPos = start + text.length;
              input.setSelectionRange(newPos, newPos);

              // Trigger input event for React/frameworks
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
            } else if (targetEl && targetEl.isContentEditable) {
              // Handle contentEditable elements
              targetEl.focus();

              const selection = window.getSelection();
              if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode(document.createTextNode(text));
                range.collapse(false);
              } else {
                // If no selection, try to insert at the end
                const range = document.createRange();
                range.selectNodeContents(targetEl);
                range.collapse(false);
                range.insertNode(document.createTextNode(text));
              }
            }
          } catch (err) {
            log("Paste error:", err);
          }
        },
      },
      {
        id: "go-left",
        label: "Go to Previous Tab",
        icon: ChevronLeft,
        onInvoke: () => {
          navigateTab("left");
          closeMenu();
        },
      },
      {
        id: "go-right",
        label: "Go to Next Tab",
        icon: ChevronRight,
        onInvoke: () => {
          navigateTab("right");
          closeMenu();
        },
      },
      {
        id: "open-in-new-tab",
        label: "Open in New Tab",
        icon: ExternalLink,
        requiresUrl: true,
        onInvoke: () => {
          if (clickedUrl) {
            try {
              log("Opening URL in new tab:", clickedUrl);
              chrome.runtime.sendMessage({
                action: "openUrl",
                url: clickedUrl,
              });
            } catch (_) {}
          }
        },
      },
      {
        id: "save-as",
        label: "Save As...",
        icon: Download,
        requiresUrl: true,
        onInvoke: () => {
          if (clickedUrl) {
            try {
              // Try using downloads API
              chrome.runtime.sendMessage({
                action: "downloadUrl",
                url: clickedUrl,
              });
            } catch (e) {
              // Fallback to anchor click
              const a = document.createElement("a");
              a.href = clickedUrl;
              a.download = "";
              a.click();
            }
          }
        },
      },
    ];

    const actions: MenuAction[] = [
      {
        id: "ebay-sold",
        label: "Search eBay Sold",
        shortcut: "E",
        description: "Search for completed sold listings",
        icon: PackageSearch,
        requiresSelection: true,
        getUrl: (s) => buildEbaySoldUrl(s),
        onInvoke: ({ selection }) =>
          selection && openSearchPopup(buildEbaySoldUrl(selection)),
      },
      {
        id: "google-upc",
        label: "Google for UPC",
        shortcut: "G",
        description: "Find products by UPC code",
        icon: Search,
        requiresSelection: true,
        getUrl: (s) =>
          `https://www.google.com/search?q=${encodeURIComponent(
            "UPC for " + s
          )}`,
        onInvoke: ({ selection }) =>
          selection &&
          openSearchPopup(
            `https://www.google.com/search?q=${encodeURIComponent(
              "UPC for " + selection
            )}`
          ),
      },
      {
        id: "mpn-google",
        label: "Google for MPN",
        shortcut: "M",
        description: "Find manufacturer part numbers on Google",
        icon: Search,
        requiresSelection: true,
        getUrl: (s) =>
          `https://www.google.com/search?q=${encodeURIComponent(
            "MPN for " + s
          )}`,
        onInvoke: ({ selection }) =>
          selection &&
          openSearchPopup(
            `https://www.google.com/search?q=${encodeURIComponent(
              "MPN for " + selection
            )}`
          ),
      },

      {
        id: "upcitemdb",
        label: "Search UPCItemDB",
        shortcut: "U",
        description: "Look up product information by UPC",
        icon: Barcode,
        requiresSelection: true,
        getUrl: (s) => `https://www.upcitemdb.com/upc/${encodeURIComponent(s)}`,
        onInvoke: ({ selection }) =>
          selection &&
          openSearchPopup(
            `https://www.upcitemdb.com/upc/${encodeURIComponent(selection)}`
          ),
      },
      {
        id: "pricecharting",
        label: "Search PriceCharting",
        shortcut: "P",
        description: "Check prices for collectibles and games",
        icon: TrendingUp,
        requiresSelection: true,
        getUrl: (s) => buildSearchUrl(SEARCH_URL_TEMPLATES.pricecharting, s),
        onInvoke: ({ selection }) =>
          selection &&
          openSearchPopup(buildSearchUrl(SEARCH_URL_TEMPLATES.pricecharting, selection)),
      },
      {
        id: "mobile-scanner",
        label: "Mobile Scanner",
        shortcut: "V",
        description: "Open mobile scanner",
        icon: Smartphone,
        onInvoke: () => openMobileCapture("barcode"),
      },
      {
        id: "settings",
        label: "Settings",
        shortcut: "S",
        description: "Open extension settings",
        icon: Settings,
        onInvoke: () => {
          try {
            chrome.runtime.sendMessage({ action: "open-settings" });
          } catch (_) {}
        },
      },
    ];

    // Shadow DOM
    let host: HTMLDivElement | null = null;
    let shadow: ShadowRoot | null = null;
    let rootEl: HTMLDivElement | null = null;
    let reactRoot: Root | null = null;

    const styles = () => `
      :host{all:initial}
      .scout-cm-root{position:fixed;inset:0;z-index:2147483647}
      .overlay{position:fixed;inset:0;background:transparent}
      .menu{position:absolute;min-width:240px;max-width:320px;background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 20px 45px rgba(0,0,0,.18);overflow:hidden;font-family:ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif}
      .hdr{padding:8px 12px;border-bottom:1px solid #f3f4f6;font:600 12px/1 ui-sans-serif, system-ui, -apple-system;color:#6b7280;background:#fafafa;display:flex;justify-content:space-between;align-items:center}
      .dismiss-btn{background:none;border:none;padding:0;color:#9ca3af;cursor:pointer;font-size:11px;font-weight:500;transition:color 0.15s}
      .dismiss-btn:hover{color:#4b5563}
      .quick-actions{display:flex;gap:4px;padding:8px;border-bottom:1px solid #f3f4f6;background:#fafafa}
      .icon-btn-wrapper{position:relative;display:inline-flex}
      .icon-btn{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;cursor:pointer;border:none;background:#fff;color:#374151;transition:all 0.15s}
      .icon-btn:hover:not(:disabled){background:#e5e7eb;color:#111827}
      .icon-btn:active:not(:disabled){background:#d1d5db}
      .icon-btn:disabled{opacity:0.4;cursor:not-allowed}
      .tooltip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.2s;z-index:10}
      .tooltip::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:#111827}
      .icon-btn-wrapper:hover .tooltip{opacity:1}
      .icon-btn:disabled + .tooltip{display:none}
      .group{padding:6px 6px}
      .item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;outline:none;font-size:14px;font-weight:400;transition:all 0.15s;position:relative}
      .item:hover:not(.disabled){background:#f3f4f6}
      .item[aria-selected="true"]:not(.disabled), .item:focus:not(.disabled){background:#e5e7eb}
      .item .new-tab-btn{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;border:none;background:transparent;color:#9ca3af;cursor:pointer;transition:all 0.15s;opacity:0;margin-left:4px}
      .item:hover .new-tab-btn{opacity:1}
      .item .new-tab-btn:hover{background:#d1d5db;color:#111827}
      .item.disabled{opacity:0.4;cursor:not-allowed}
      .item-tooltip{position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);background:#111827;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.2s;z-index:10;max-width:200px}
      .item:hover .item-tooltip{opacity:1;transition-delay:0.5s}
      .item.disabled .item-tooltip{display:none}
      .icon{width:18px;height:18px;color:#6b7280;display:flex;align-items:center;justify-content:center}
      .label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px;line-height:1.5}
      .shortcut{color:#6b7280;font:600 11px/1 ui-sans-serif, system-ui, -apple-system}
      .sep{height:1px;background:#f3f4f6;margin:4px 0}
      .empty-hint{padding:8px 12px;font-size:12px;color:#9ca3af;text-align:center;font-style:italic}
    `;

    const ensureHost = () => {
      if (host && shadow && rootEl) return;
      host = document.createElement("div");
      host.style.all = "initial";
      host.style.position = "fixed";
      host.style.inset = "0";
      host.style.zIndex = "2147483647";
      host.style.pointerEvents = "none"; // Initially hidden
      shadow = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = styles();
      rootEl = document.createElement("div");
      rootEl.className = "scout-cm-root";
      shadow.appendChild(style);
      shadow.appendChild(rootEl);
      document.documentElement.appendChild(host);
    };

    let isOpen = false;
    let lastSelection = "";
    let x = 0,
      y = 0;
    let focusedElementBeforeMenu: HTMLElement | null = null;
    let clickedElement: HTMLElement | null = null;
    let clickedUrl: string | null = null;
    type CloseMenuOptions = {
      restoreFocus?: boolean;
    };

    // Menu React component
    const Menu: React.FC = () => {
      const items = useMemo(() => actions, []);
      const hasSelection = !!lastSelection;

      const visibleItems = useMemo(() => {
        return items.filter((item) => {
          // if (item.requiresSelection && !hasSelection) return false;
          if (item.requiresUrl && !clickedUrl) return false;
          return true;
        });
      }, [items, hasSelection]);

      const [index, setIndex] = useState(0);

      // Positioning within viewport
      const [pos, setPos] = useState({ left: x, top: y });
      useEffect(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = 280; // approx
        const contentHeight =
          visibleItems.length * 40 + (visibleItems.length === 0 ? 40 : 0);
        const height = 12 + 48 + 52 + contentHeight; // hdr + quick + content
        let left = x,
          top = y;
        if (left + width > vw - 8) left = vw - width - 8;
        if (top + height > vh - 8) top = vh - height - 8;
        setPos({ left, top });
      }, [visibleItems.length]);

      useEffect(() => {
        const handle = (ev: KeyboardEvent) => {
          if (visibleItems.length === 0) return;

          if (ev.key === "ArrowDown") {
            ev.preventDefault();
            setIndex((i) => (i + 1) % visibleItems.length);
          } else if (ev.key === "ArrowUp") {
            ev.preventDefault();
            setIndex(
              (i) => (i - 1 + visibleItems.length) % visibleItems.length
            );
          } else if (ev.key === "Enter") {
            ev.preventDefault();
            const item = visibleItems[index];
            if (item) {
              try {
                item.onInvoke({ x, y, selection: lastSelection });
              } catch (_) {}
              closeMenu({ restoreFocus: false });
            }
          } else {
            // Check for letter shortcuts
            const key = ev.key.toUpperCase();
            const matchingItem = visibleItems.find(
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
      }, [index, visibleItems, hasSelection]);

      const onOverlayClick = (e: React.MouseEvent) => {
        const path = (e.nativeEvent as any).composedPath?.() || [];
        const el = path[0] as HTMLElement;
        if (!(el.closest && el.closest(".menu"))) closeMenu();
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
        dismissedUntilRefresh = true;
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
            className="menu"
            style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
          >
            <div className="hdr">
              <span>Volt</span>
              <button className="dismiss-btn" onClick={onDismiss}>
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
                    onClick={() => !disabled && onQuickActionClick(action)}
                  >
                    <button className="icon-btn" disabled={disabled}>
                      {action.icon && <action.icon size={16} />}
                    </button>
                    <div className="tooltip">{action.label}</div>
                  </div>
                );
              })}
            </div>
            <div className="group">
              {!hasSelection && (
                <div className="empty-hint" style={{ opacity: 0.5 }}>
                  Select Text For More Options
                </div>
              )}
              {visibleItems.length === 0 && hasSelection && (
                <div className="empty-hint">No matching actions</div>
              )}
              {visibleItems.map((item, i) => (
                <div
                  key={item.id}
                  className={`item ${
                    item.requiresSelection && !hasSelection ? "disabled" : ""
                  }`}
                  tabIndex={-1}
                  aria-selected={i === index}
                  onClick={() => {
                    if (item.requiresSelection && !hasSelection) return;
                    onItemClick(item);
                  }}
                  onMouseEnter={() => setIndex(i)}
                >
                  <div className="icon">
                    {item.icon && <item.icon size={16} />}
                  </div>
                  <div className="label">{item.label}</div>
                  {item.getUrl && hasSelection && (
                    <button
                      className="new-tab-btn"
                      title="Open in New Tab"
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
              ))}
            </div>
          </div>
        </div>
      );
    };

    const openMenu = () => {
      if (isOpen) closeMenu();
      ensureHost();
      if (!host || !rootEl || !shadow) return;

      host.style.pointerEvents = "auto";
      isOpen = true;
      if (!reactRoot) reactRoot = createRoot(rootEl);
      reactRoot.render(<Menu />);
    };

    const closeMenu = (options: CloseMenuOptions = {}) => {
      if (!isOpen) return;
      const { restoreFocus = true } = options;
      isOpen = false;
      if (host) host.style.pointerEvents = "none";
      if (reactRoot) {
        reactRoot.unmount();
        reactRoot = null;
      }
      if (restoreFocus && focusedElementBeforeMenu) {
        try {
          focusedElementBeforeMenu.focus();
        } catch (_) {}
      }
      focusedElementBeforeMenu = null;
    };

    document.addEventListener(
      "contextmenu",
      (e) => {
        // Allow native menu if Ctrl key is pressed or feature is disabled
        // or if extension has been dismissed for this session
        if (e.ctrlKey || !enabled || dismissedUntilRefresh) return;

        // Prevent menu on inputs if selection is empty? No, we want quick actions like Paste.
        // Just let it open.

        // Store clicked element for actions like "Delete Element" or "Paste"
        clickedElement = e.target as HTMLElement;

        // Check if clicked element is a link or inside a link
        clickedUrl = null;
        const link = clickedElement.closest("a");
        if (link && link.href) {
          clickedUrl = link.href;
        } else if (clickedElement.tagName === "IMG") {
          // Also allow image source? Maybe later.
          // For now just check links.
        }

        // If clicked inside an editable area, we might want native menu for spellcheck?
        // But user can use Ctrl+Click for that. We override by default.

        const sel = window.getSelection();
        lastSelection = sel ? sel.toString().trim() : "";
        x = e.clientX;
        y = e.clientY;
        focusedElementBeforeMenu = document.activeElement as HTMLElement;

        e.preventDefault();
        e.stopPropagation();
        openMenu();
      },
      true
    );

    document.addEventListener("mousedown", (e) => {
      if (!isOpen) return;
      // If click is outside shadow host, close menu
      // BUT the host covers the screen. The overlay inside handles clicks.
      // So we rely on React component's onClick.
    });

    window.addEventListener("scroll", () => {
      if (isOpen) closeMenu();
    });

    window.addEventListener("resize", () => {
      if (isOpen) closeMenu();
    });

    // Close popup when main window is focused
    // Notify background script to close Chrome API-managed preview popup
    window.addEventListener("focus", () => {
      // Notify background script to close the preview popup (handles COOP-protected sites like Google)
      try {
        chrome.runtime.sendMessage({ action: "parentWindowFocused" });
      } catch (_) {}

      // Also handle legacy window.open popups
      if (
        activePopup &&
        Date.now() - activePopupOpenedAt >= POPUP_OPENING_GRACE_MS
      ) {
        try {
          if (!activePopup.closed) {
            activePopup.close();
          }
        } catch (e) {
          // Cross-origin restriction (COOP headers) prevents closing
          log("Could not close popup (cross-origin):", e);
        }
        activePopup = null;
      }
    });
  },
});
