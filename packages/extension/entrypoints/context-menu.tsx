// @ts-nocheck
import { ContextMenu, type MenuAction } from "../src/components/context-menu";
import { styles, selectionStyles } from "../src/components/context-menu-styles";
import { SelectionSuggestionPill, type SelectionSearchActionId } from "../src/components/selection-suggestion-pill";
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */

import { defineContentScript } from "wxt/utils/define-content-script";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMobileCaptureController } from "./context-menu-mobile-capture";
import { initializeSidePanelContext } from "../src/lib/sidepanel-gesture";
import { buildSearchUrl, SEARCH_URL_TEMPLATES } from "../src/domain/search";
import { normalizeSelectionSuggestionText, positionSelectionSuggestions, shouldShowSelectionSuggestions } from "../src/domain/selection-suggestions";
import { Search, PackageSearch, TrendingUp, Copy, Clipboard, ExternalLink, Download, Settings, ChevronLeft, ChevronRight, Smartphone, Calculator } from "lucide-react";

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
    const openMenu = () => {
      closeSelectionSuggestions({ suppressCurrent: true });
      if (isOpen) closeMenu();
      ensureHost();
      if (!host || !rootEl || !shadow) return;

      host.style.pointerEvents = "auto";
      isOpen = true;
      if (!reactRoot) reactRoot = createRoot(rootEl);
      reactRoot.render(<ContextMenu actions={actions} quickActions={quickActions} lastSelection={lastSelection} clickedUrl={clickedUrl} x={x} y={y} closeMenu={closeMenu} openUrl={openUrl} dismiss={() => { dismissedUntilRefresh = true; }} />);
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
