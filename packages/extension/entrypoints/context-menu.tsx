// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */

import { defineContentScript } from "wxt/utils/define-content-script";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMobileCaptureController } from "./context-menu-mobile-capture";
import { initializeSidePanelContext } from "../src/lib/sidepanel-gesture";
import { buildSearchUrl, SEARCH_URL_TEMPLATES } from "../src/domain/search";
import {
  normalizeSelectionSuggestionText,
  positionSelectionSuggestions,
  shouldShowSelectionSuggestions,
} from "../src/domain/selection-suggestions";
import {
  Search,
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
  Calculator,
} from "lucide-react";

type SelectionSearchActionId = "ebay" | "google" | "pricecharting";
type SelectionSuggestionPosition = ReturnType<
  typeof positionSelectionSuggestions
>;

const selectionSearchActions: Array<{
  id: SelectionSearchActionId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: "ebay", label: "eBay Prices", icon: PackageSearch },
  { id: "google", label: "Search for UPC", icon: Search },
  { id: "pricecharting", label: "PriceCharting", icon: TrendingUp },
];

function SelectionSuggestionPill({
  onCopy,
  onSearch,
  position,
}: {
  onCopy: () => void;
  onSearch: (actionId: SelectionSearchActionId) => void;
  position: SelectionSuggestionPosition;
}) {
  return (
    <div
      aria-label="Actions for selected text"
      className="selection-pill"
      data-placement={position.placement}
      role="toolbar"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
      }}
    >
      {selectionSearchActions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            aria-label={action.label}
            className="selection-action selection-search-action"
            onClick={() => onSearch(action.id)}
            onPointerDown={(event) => event.preventDefault()}
            title={action.label}
            type="button"
          >
            <Icon size={16} />
            <span>{action.label}</span>
          </button>
        );
      })}
      <button
        aria-label="Copy selected text"
        className="selection-copy"
        onClick={onCopy}
        onPointerDown={(event) => event.preventDefault()}
        title="Copy selected text"
        type="button"
      >
        <Copy size={15} />
        <span>Copy selected text</span>
      </button>
    </div>
  );
}

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
        console.log("[Volt CtxMenu]", ...args);
      } catch (_) {}
    };

    // Feature flag from settings
    let enabled = true;
    let selectionSuggestionsEnabled = true;
    let dismissedUntilRefresh = false;
    let activePopup: Window | null = null;
    let activePopupOpenedAt = 0;
    const POPUP_OPENING_GRACE_MS = 700;
    try {
      chrome.storage.sync.get(["cmdkSettings"], (result) => {
        const s = result?.cmdkSettings || {};
        enabled = s?.contextMenu?.enabled ?? true;
        selectionSuggestionsEnabled =
          s?.contextMenu?.selectionSuggestionsEnabled ?? true;
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
          "volt_search_popup",
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );
        activePopupOpenedAt = Date.now();
      }
    };

    const buildEbaySoldUrl = (q: string) => {
      return buildSearchUrl(SEARCH_URL_TEMPLATES.ebay, q);
    };

    const buildGoogleUpcUrl = (q: string) => {
      return `https://www.google.com/search?q=${encodeURIComponent(
        `UPC for ${q}`,
      )}`;
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

    const mobileCapture = createMobileCaptureController({
      getFocusedElement: () => focusedElementBeforeMenu,
      getClickedElement: () => clickedElement,
      log,
    });
    mobileCapture.installMobileCursorTargetTracker();

    const openSidepanelTool = (tool: string) => {
      try {
        chrome.runtime.sendMessage({ action: "openInSidebar", tool, mode: "open" });
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
        label: "eBay Prices",
        shortcut: "E",
        description: "Search completed sold listings for pricing",
        icon: PackageSearch,
        requiresSelection: true,
        getUrl: (s) => buildEbaySoldUrl(s),
        onInvoke: ({ selection }) =>
          selection && openSearchPopup(buildEbaySoldUrl(selection)),
      },
      {
        id: "google-upc",
        label: "Search for UPC",
        shortcut: "G",
        description: "Find products by UPC code",
        icon: Search,
        requiresSelection: true,
        getUrl: (s) => buildGoogleUpcUrl(s),
        onInvoke: ({ selection }) =>
          selection && openSearchPopup(buildGoogleUpcUrl(selection)),
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
        onInvoke: () => mobileCapture.openMobileCapture("barcode"),
      },
      {
        id: "offer-calculator",
        label: "Offer Calculator",
        shortcut: "O",
        description: "Open offer calculator in the sidepanel",
        icon: Calculator,
        onInvoke: () => openSidepanelTool("top-offers"),
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
    let selectionHost: HTMLDivElement | null = null;
    let selectionRootEl: HTMLDivElement | null = null;
    let selectionReactRoot: Root | null = null;
    let selectionFrame: number | null = null;
    let selectionPointerIsDown = false;
    let activeSuggestionSelection = "";
    let suppressedSuggestionSelection = "";

    const styles = () => `
      :host{all:initial}
      .volt-cm-root{position:fixed;inset:0;z-index:2147483647}
      .overlay{position:fixed;inset:0;background:transparent}
      .menu{position:absolute;width:min(312px,calc(100vw - 16px));max-height:calc(100vh - 16px);background:rgba(255,255,255,.99);color:#0f172a;border:1px solid rgba(148,163,184,.3);border-radius:16px;box-shadow:0 24px 60px rgba(15,23,42,.2),0 4px 14px rgba(15,23,42,.1);overflow-x:hidden;overflow-y:auto;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      .hdr{height:44px;padding:0 14px;border-bottom:1px solid #eef2f7;font:700 14px/1 ui-sans-serif,system-ui,-apple-system;color:#475569;background:#fff;display:flex;justify-content:space-between;align-items:center}
      .dismiss-btn{background:none;border:none;border-radius:7px;padding:6px 7px;color:#94a3b8;cursor:pointer;font:600 11px/1 ui-sans-serif,system-ui,-apple-system;transition:background .12s,color .12s}
      .dismiss-btn:hover{background:#f1f5f9;color:#475569}
      .dismiss-btn:focus-visible,.icon-btn:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
      .quick-actions{display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid #eef2f7;background:#f8fafc}
      .icon-btn-wrapper{position:relative;display:flex;flex:1;min-width:0}
      .icon-btn{display:flex;align-items:center;justify-content:center;width:100%;height:40px;border-radius:10px;cursor:pointer;border:1px solid #e9eef5;background:#fff;color:#334155;box-shadow:0 1px 2px rgba(15,23,42,.04);transition:background .12s,border-color .12s,color .12s,transform .12s}
      .icon-btn:hover:not(:disabled){background:#f1f5f9;border-color:#dbe3ed;color:#0f172a}
      .icon-btn:active:not(:disabled){background:#e2e8f0;transform:scale(.97)}
      .icon-btn:disabled{opacity:0.4;cursor:not-allowed}
      .tooltip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.2s;z-index:10}
      .tooltip::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:#111827}
      .icon-btn-wrapper:hover .tooltip{opacity:1}
      .icon-btn:disabled + .tooltip{display:none}
      .selection-context{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid #eef2f7;background:#fff;font-size:12px;line-height:1.3}
      .selection-context-label{flex:none;color:#94a3b8;font-weight:600}
      .selection-context-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155;font-weight:600}
      .group{padding:7px}
      .section-label{padding:7px 10px 5px;color:#94a3b8;font:700 10px/1 ui-sans-serif,system-ui,-apple-system;text-transform:uppercase;letter-spacing:.08em}
      .item{display:flex;align-items:center;gap:10px;min-height:40px;padding:0 10px;border-radius:9px;cursor:pointer;outline:none;font-size:14px;font-weight:450;transition:background .12s,color .12s;position:relative}
      .item:hover:not(.disabled){background:#f1f5f9}
      .item[data-active="true"]:not(.disabled),.item:focus:not(.disabled){background:#e8eef5}
      .item .new-tab-btn{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;border:none;background:transparent;color:#9ca3af;cursor:pointer;transition:all 0.15s;opacity:0;margin-left:4px}
      .item:hover .new-tab-btn{opacity:1}
      .item .new-tab-btn:hover{background:#d1d5db;color:#111827}
      .item .new-tab-btn:focus-visible{opacity:1;outline:2px solid #22c55e;outline-offset:1px}
      .item.disabled{opacity:0.4;cursor:not-allowed}
      .item-tooltip{position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);background:#111827;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.2s;z-index:10;max-width:200px}
      .item:hover .item-tooltip{opacity:1;transition-delay:0.5s}
      .item.disabled .item-tooltip{display:none}
      .icon{width:18px;height:18px;color:#6b7280;display:flex;align-items:center;justify-content:center}
      .label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px;line-height:1.5}
      .shortcut{color:#6b7280;font:600 11px/1 ui-sans-serif, system-ui, -apple-system}
      .sep{height:1px;background:#eef2f7;margin:6px 4px}
      .empty-hint{padding:10px 14px;border-bottom:1px solid #eef2f7;background:#fff;font-size:12px;color:#94a3b8;text-align:left}
    `;

    const selectionStyles = () => `
      :host{all:initial}
      .selection-pill{box-sizing:border-box;position:fixed;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:4px;background:rgba(255,255,255,.98);color:#1f2937;border:1px solid rgba(148,163,184,.32);border-radius:13px;box-shadow:0 12px 30px rgba(15,23,42,.18),0 2px 8px rgba(15,23,42,.1);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:auto;isolation:isolate;animation:volt-selection-enter 90ms ease-out}
      .selection-pill::after{content:'';position:absolute;left:50%;width:10px;height:10px;background:#fff;border-right:1px solid rgba(148,163,184,.32);border-bottom:1px solid rgba(148,163,184,.32);transform:translateX(-50%) rotate(45deg);z-index:-1}
      .selection-pill[data-placement='above']::after{bottom:-6px}
      .selection-pill[data-placement='below']::after{top:-6px;transform:translateX(-50%) rotate(225deg)}
      .selection-action{box-sizing:border-box;display:flex;min-width:0;height:36px;align-items:center;justify-content:center;gap:7px;flex:1;border:0;border-radius:9px;background:transparent;color:#334155;padding:0 9px;cursor:pointer;font:600 12px/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;transition:background 100ms ease,color 100ms ease,transform 100ms ease}
      .selection-action:hover{background:#f1f5f9;color:#0f172a}
      .selection-action:active{background:#e2e8f0;transform:scale(.98)}
      .selection-action:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
      .selection-action svg{flex:none}
      .selection-copy{box-sizing:border-box;display:flex;grid-column:1/-1;align-items:center;justify-content:center;gap:7px;height:32px;margin-top:2px;border:0;border-top:1px solid #eef2f7;border-radius:0 0 9px 9px;background:transparent;color:#64748b;cursor:pointer;font:600 12px/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;transition:background 100ms ease,color 100ms ease}
      .selection-copy:hover{background:#f1f5f9;color:#0f172a}
      .selection-copy:active{background:#e2e8f0}
      .selection-copy:focus-visible{outline:2px solid #22c55e;outline-offset:1px}
      @keyframes volt-selection-enter{from{opacity:0;transform:translateY(3px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
      @media (max-width:420px){.selection-search-action span{display:none}.selection-action{padding:0 8px}}
      @media (prefers-reduced-motion:reduce){.selection-pill{animation:none}.selection-action,.selection-copy{transition:none}}
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
      rootEl.className = "volt-cm-root";
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

    const ensureSelectionHost = () => {
      if (selectionHost && selectionRootEl && selectionReactRoot) return;
      selectionHost = document.createElement("div");
      selectionHost.style.all = "initial";
      selectionHost.style.position = "fixed";
      selectionHost.style.inset = "0";
      selectionHost.style.zIndex = "2147483646";
      selectionHost.style.pointerEvents = "none";
      const selectionShadow = selectionHost.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = selectionStyles();
      selectionRootEl = document.createElement("div");
      selectionShadow.appendChild(style);
      selectionShadow.appendChild(selectionRootEl);
      document.documentElement.appendChild(selectionHost);
      selectionReactRoot = createRoot(selectionRootEl);
    };

    const closeSelectionSuggestions = ({
      suppressCurrent = false,
    }: {
      suppressCurrent?: boolean;
    } = {}) => {
      if (selectionFrame !== null) {
        window.cancelAnimationFrame(selectionFrame);
        selectionFrame = null;
      }
      if (suppressCurrent && activeSuggestionSelection) {
        suppressedSuggestionSelection = activeSuggestionSelection;
      }
      activeSuggestionSelection = "";
      selectionReactRoot?.unmount();
      selectionReactRoot = null;
      selectionRootEl = null;
      selectionHost?.remove();
      selectionHost = null;
    };

    const getSelectionSnapshot = () => {
      const pageSelection = window.getSelection();
      if (
        !pageSelection ||
        pageSelection.isCollapsed ||
        pageSelection.rangeCount === 0
      ) {
        return null;
      }

      const selection = normalizeSelectionSuggestionText(
        pageSelection.toString(),
      );
      const selectionNode = pageSelection.anchorNode;
      const selectionElement =
        selectionNode instanceof Element
          ? selectionNode
          : selectionNode?.parentElement ?? null;
      const isEditable =
        document.designMode?.toLowerCase() === "on" ||
        Boolean(
          selectionElement?.closest(
            "input, textarea, [contenteditable=''], [contenteditable='true'], [role='textbox']",
          ),
        );
      const range = pageSelection.getRangeAt(0);
      const visibleRects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      const sourceRect =
        visibleRects[visibleRects.length - 1] ?? range.getBoundingClientRect();
      const rect = {
        bottom: sourceRect.bottom,
        height: sourceRect.height,
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
      };

      if (
        !shouldShowSelectionSuggestions({
          enabled: selectionSuggestionsEnabled,
          isEditable,
          rect,
          selection,
        })
      ) {
        return null;
      }

      return { rect, selection };
    };

    const openSelectionSearch = (
      actionId: SelectionSearchActionId,
      selection: string,
    ) => {
      suppressedSuggestionSelection = selection;
      closeSelectionSuggestions();
      if (actionId === "ebay") {
        openSearchPopup(buildEbaySoldUrl(selection));
        return;
      }
      if (actionId === "google") {
        openSearchPopup(buildGoogleUpcUrl(selection));
        return;
      }
      openSearchPopup(
        buildSearchUrl(SEARCH_URL_TEMPLATES.pricecharting, selection),
      );
    };

    const copySelection = async (selection: string) => {
      const copied = await copyToClipboard(selection);
      if (!copied) return;

      suppressedSuggestionSelection = selection;
      closeSelectionSuggestions();
    };

    const renderSelectionSuggestions = ({
      rect,
      selection,
    }: {
      rect: {
        bottom: number;
        height: number;
        left: number;
        top: number;
        width: number;
      };
      selection: string;
    }) => {
      ensureSelectionHost();
      if (!selectionReactRoot) return;
      activeSuggestionSelection = selection;
      const position = positionSelectionSuggestions({
        rect,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      });
      selectionReactRoot.render(
        <SelectionSuggestionPill
          onCopy={() => {
            void copySelection(selection);
          }}
          onSearch={(actionId) =>
            openSelectionSearch(actionId, selection)
          }
          position={position}
        />,
      );
    };

    const scheduleSelectionSuggestions = () => {
      if (selectionFrame !== null) {
        window.cancelAnimationFrame(selectionFrame);
      }
      selectionFrame = window.requestAnimationFrame(() => {
        selectionFrame = null;
        if (isOpen || selectionPointerIsDown || !selectionSuggestionsEnabled) {
          closeSelectionSuggestions();
          return;
        }
        const snapshot = getSelectionSnapshot();
        if (!snapshot) {
          suppressedSuggestionSelection = "";
          closeSelectionSuggestions();
          return;
        }
        if (snapshot.selection === suppressedSuggestionSelection) {
          closeSelectionSuggestions();
          return;
        }
        renderSelectionSuggestions(snapshot);
      });
    };

    // Menu React component
    const Menu: React.FC = () => {
      const items = useMemo(() => actions, []);
      const hasSelection = !!lastSelection;
      const menuRef = useRef<HTMLDivElement>(null);

      const visibleItems = useMemo(() => {
        return items.filter((item) => {
          // if (item.requiresSelection && !hasSelection) return false;
          if (item.requiresUrl && !clickedUrl) return false;
          return true;
        });
      }, [items, hasSelection]);

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
      }, [hasSelection, visibleItems.length]);

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
      }, [enabledItems, index]);

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
                    {i === 0 && (
                      <div className="section-label">Search selected text</div>
                    )}
                    {i === 3 && (
                      <>
                        <div className="sep" />
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
    };

    const openMenu = () => {
      closeSelectionSuggestions({ suppressCurrent: true });
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
        closeSelectionSuggestions({ suppressCurrent: true });
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

    document.addEventListener("selectionchange", scheduleSelectionSuggestions);
    document.addEventListener(
      "pointerup",
      (event) => {
        if (selectionHost && event.composedPath().includes(selectionHost)) return;
        selectionPointerIsDown = false;
        scheduleSelectionSuggestions();
      },
      true,
    );
    document.addEventListener("keyup", scheduleSelectionSuggestions, true);
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (selectionHost && event.composedPath().includes(selectionHost)) return;
        selectionPointerIsDown = true;
        closeSelectionSuggestions({ suppressCurrent: true });
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          closeSelectionSuggestions({ suppressCurrent: true });
        }
      },
      true,
    );

    document.addEventListener("mousedown", (e) => {
      if (!isOpen) return;
      // If click is outside shadow host, close menu
      // BUT the host covers the screen. The overlay inside handles clicks.
      // So we rely on React component's onClick.
    });

    window.addEventListener(
      "scroll",
      () => {
        if (isOpen) closeMenu();
        closeSelectionSuggestions();
      },
      true,
    );

    window.addEventListener("resize", () => {
      if (isOpen) closeMenu();
      closeSelectionSuggestions();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.action === "context-menu-settings-changed") {
        enabled = Boolean(message.enabled);
        if (!enabled) closeMenu();
      }
      if (message?.action === "selection-suggestions-settings-changed") {
        selectionSuggestionsEnabled = Boolean(message.enabled);
        if (selectionSuggestionsEnabled) {
          scheduleSelectionSuggestions();
        } else {
          closeSelectionSuggestions();
        }
      }
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
