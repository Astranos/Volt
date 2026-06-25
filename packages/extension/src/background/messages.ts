export type MessageRecord = Record<string, unknown>;

export type RuntimeMessageResponse = unknown;
export type RuntimeSendResponse = (response?: RuntimeMessageResponse) => void;

export type RuntimeMessageSender =
  Parameters<typeof chrome.runtime.onMessage.addListener>[0] extends (
    message: unknown,
    sender: infer TSender,
    sendResponse: (...args: unknown[]) => void
  ) => unknown
    ? TSender
    : { tab?: { id?: number; url?: string; windowId?: number }; frameId?: number };

export type TabInfo = {
  id?: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  active?: boolean;
  windowId?: number;
};

export type ClosedTabInfo = Omit<TabInfo, "id"> & {
  id?: string;
  lastModified?: number;
};

export type BasicSuccessResponse =
  | { success: true; [key: string]: unknown }
  | { success: false; error: string; [key: string]: unknown };

export type HealthCheckMessage = { type: "EXTENSION_HEALTH_CHECK" };
export type ContentScriptReadyMessage = { type: "CONTENT_SCRIPT_READY" };
export type PriceChartingItemSelectedMessage = {
  type: "PC_ITEM_SELECTED";
  data: unknown;
};

export type TabRuntimeMessage =
  | { action: "GET_TABS" }
  | { action: "GET_CLOSED_TABS" }
  | { action: "RESTORE_TAB"; sessionId?: string; closeTabId?: number }
  | { action: "SWITCH_TAB"; tabId?: number }
  | { action: "GET_PREVIOUS_TAB" }
  | { action: "OPEN_TAB"; url?: string }
  | { action: "UPDATE_CURRENT_TAB"; url?: string };

export type ScannerRuntimeMessage =
  | { action: "scannerStart"; force?: boolean; mode?: unknown }
  | { action: "scannerStartForMode"; force?: boolean; mode?: unknown }
  | { action: "openMobileCapture"; mode?: unknown; surface?: string; target?: unknown }
  | { action: "openMobileCapturePopup"; mode?: unknown; target?: unknown }
  | { action: "scannerDisconnect" }
  | { action: "scannerCloseJoinWindow" }
  | { action: "scannerPairingPopupClosed" }
  | { action: "scannerGetState" }
  | { action: "scannerUpdateExtensionIdentity"; identity?: unknown }
  | { action: "scannerGetPushSubscription" }
  | { action: "mobileCursorTargetChanged"; target?: unknown }
  | { action: "scannerStateChanged"; source?: string; state?: unknown }
  | { action: "scannerDebugLog"; args?: unknown[] }
  | { action: "scannerOffscreenScan"; scan?: unknown }
  | { action: "scannerOffscreenPhoto"; photo?: unknown };

export type ScannerOffscreenRuntimeMessage =
  | { action: "scannerOffscreenPing" }
  | { action: "scannerOffscreenStart"; force?: boolean; mode?: unknown; target?: unknown }
  | { action: "scannerOffscreenDisconnect" }
  | { action: "scannerOffscreenCloseJoinWindow" }
  | { action: "scannerOffscreenGetState" }
  | { action: "scannerOffscreenUpdateExtensionIdentity"; identity?: unknown }
  | { action: "scannerOffscreenUpdateTarget"; target?: unknown }
  | { action: "scannerOffscreenPollReconnectRequests"; reason?: string };

export type AnchorPoint = {
  x?: number;
  y?: number;
};

export type BackgroundActionMessage =
  | { action: "fetchResource"; url?: string }
  | { action: "csReady"; url?: string }
  | { action: "openInActionPopup"; tool?: string }
  | { action: "openInSidebar"; tool?: string; mode?: string; tabId?: number }
  | { action: "getSidePanelStateForTab"; tabId?: number }
  | { action: "sidePanelDidClose"; windowId?: number }
  | {
      action: "sidePanelToggleResult";
      tabId?: number;
      status?: string;
      tool?: string;
      error?: string;
      source?: string;
    }
  | { action: "closeSidebar"; tabId?: number }
  | { action: "openToolWindow"; tool?: string }
  | { action: "openToolWindowAt"; tool?: string; anchor: AnchorPoint }
  | { action: "resizeToolForTab"; width?: number; height?: number }
  | { action: "openPreviewPopup"; url?: string; x?: number; y?: number }
  | { action: "parentWindowFocused" }
  | { action: "promotePreviewToTab" }
  | { action: "openUrl"; url?: string }
  | { action: "OPEN_OPTIONS" }
  | { action: "open-settings"; section?: string }
  | { action: "hideControllerModal" }
  | { action: "GET_WEBPAGE_CONTEXT" }
  | { action: "getActiveTab" }
  | { action: "FETCH_CSV_LINKS"; url?: string }
  | { action: "toggleDebug"; value?: boolean }
  | { action: "generateQr"; text?: string; size?: number }
  | { action: "ping" }
  | { action: "toggleSidepanelTool"; tool?: string }
  | { action: "previousTab" }
  | { action: "nextTab" }
  | { action: "closeTab" }
  | { action: "downloadFile"; url?: string }
  | { action: "copyToClipboard"; text?: string }
  | { action: "readFromClipboard" }
  | { action: "openDevTools" }
  | { action: "goBackToPOS" }
  | { action: "checkSiteStatus"; domain?: string }
  | { action: "updateDisabledSites"; sites?: unknown[] }
  | { action: "toggleCurrentSite"; enabled?: boolean; domain?: string };

export type RuntimeMessage =
  | HealthCheckMessage
  | ContentScriptReadyMessage
  | PriceChartingItemSelectedMessage
  | TabRuntimeMessage
  | ScannerRuntimeMessage
  | ScannerOffscreenRuntimeMessage
  | BackgroundActionMessage;

const ACTIONS_WITH_NO_FIELDS = new Set([
  "GET_TABS",
  "GET_CLOSED_TABS",
  "GET_PREVIOUS_TAB",
  "scannerDisconnect",
  "scannerCloseJoinWindow",
  "scannerPairingPopupClosed",
  "scannerGetState",
  "scannerGetPushSubscription",
  "scannerOffscreenPing",
  "scannerOffscreenDisconnect",
  "scannerOffscreenCloseJoinWindow",
  "scannerOffscreenGetState",
  "parentWindowFocused",
  "promotePreviewToTab",
  "OPEN_OPTIONS",
  "hideControllerModal",
  "GET_WEBPAGE_CONTEXT",
  "getActiveTab",
  "ping",
  "previousTab",
  "nextTab",
  "closeTab",
  "readFromClipboard",
  "openDevTools",
  "goBackToPOS",
]);

export function isMessageRecord(value: unknown): value is MessageRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function getMessageAction(value: unknown): string | null {
  if (!isMessageRecord(value)) return null;
  return typeof value.action === "string" ? value.action : null;
}

export function parseMessageRecord(value: unknown): MessageRecord | null {
  return isMessageRecord(value) ? value : null;
}

export function isScannerOffscreenRuntimeMessage(
  message: RuntimeMessage
): message is ScannerOffscreenRuntimeMessage {
  if (!("action" in message)) return false;
  return (
    message.action === "scannerOffscreenPing" ||
    message.action === "scannerOffscreenStart" ||
    message.action === "scannerOffscreenDisconnect" ||
    message.action === "scannerOffscreenCloseJoinWindow" ||
    message.action === "scannerOffscreenGetState" ||
    message.action === "scannerOffscreenUpdateExtensionIdentity" ||
    message.action === "scannerOffscreenUpdateTarget" ||
    message.action === "scannerOffscreenPollReconnectRequests"
  );
}

export function parseRuntimeMessage(rawMessage: unknown): RuntimeMessage | null {
  const message = parseMessageRecord(rawMessage);
  if (!message) return null;

  const typedMessage = parseTypedMessage(message);
  if (typedMessage) return typedMessage;

  const action = optionalString(message.action);
  if (!action) return null;
  if (ACTIONS_WITH_NO_FIELDS.has(action)) {
    return { action } as RuntimeMessage;
  }

  return parseActionMessage(action, message);
}

export function parseTabRuntimeMessage(message: RuntimeMessage): TabRuntimeMessage | null {
  if (!("action" in message)) return null;
  switch (message.action) {
    case "GET_TABS":
    case "GET_CLOSED_TABS":
    case "RESTORE_TAB":
    case "SWITCH_TAB":
    case "GET_PREVIOUS_TAB":
    case "OPEN_TAB":
    case "UPDATE_CURRENT_TAB":
      return message;
    default:
      return null;
  }
}

function parseTypedMessage(message: MessageRecord): RuntimeMessage | null {
  switch (message.type) {
    case "EXTENSION_HEALTH_CHECK":
      return { type: "EXTENSION_HEALTH_CHECK" };
    case "CONTENT_SCRIPT_READY":
      return { type: "CONTENT_SCRIPT_READY" };
    case "PC_ITEM_SELECTED":
      return { type: "PC_ITEM_SELECTED", data: message.data };
    default:
      return null;
  }
}

function parseActionMessage(action: string, message: MessageRecord): RuntimeMessage | null {
  switch (action) {
    case "RESTORE_TAB":
      return {
        action,
        sessionId: optionalString(message.sessionId),
        closeTabId: optionalNumber(message.closeTabId),
      };
    case "SWITCH_TAB":
    case "getSidePanelStateForTab":
    case "closeSidebar":
      return { action, tabId: optionalNumber(message.tabId) } as RuntimeMessage;
    case "sidePanelDidClose":
      return { action, windowId: optionalNumber(message.windowId) } as RuntimeMessage;
    case "OPEN_TAB":
    case "UPDATE_CURRENT_TAB":
    case "fetchResource":
    case "openUrl":
    case "FETCH_CSV_LINKS":
    case "downloadFile":
      return { action, url: optionalString(message.url) } as RuntimeMessage;
    case "scannerStart":
    case "scannerStartForMode":
      return {
        action,
        force: optionalBoolean(message.force),
        mode: message.mode,
      };
    case "openMobileCapture":
      return {
        action,
        mode: message.mode,
        surface: optionalString(message.surface),
        target: message.target,
      };
    case "openMobileCapturePopup":
      return { action, mode: message.mode, target: message.target };
    case "scannerUpdateExtensionIdentity":
    case "scannerOffscreenUpdateExtensionIdentity":
      return { action, identity: message.identity } as RuntimeMessage;
    case "mobileCursorTargetChanged":
    case "scannerOffscreenUpdateTarget":
      return { action, target: message.target } as RuntimeMessage;
    case "scannerStateChanged":
      return {
        action,
        source: optionalString(message.source),
        state: message.state,
      };
    case "scannerDebugLog":
      return { action, args: Array.isArray(message.args) ? message.args : [] };
    case "scannerOffscreenScan":
      return { action, scan: message.scan };
    case "scannerOffscreenPhoto":
      return { action, photo: message.photo };
    case "scannerOffscreenStart":
      return {
        action,
        force: optionalBoolean(message.force),
        mode: message.mode,
        target: message.target,
      };
    case "scannerOffscreenPollReconnectRequests":
      return { action, reason: optionalString(message.reason) };
    case "csReady":
      return { action, url: optionalString(message.url) };
    case "openInActionPopup":
    case "openToolWindow":
    case "toggleSidepanelTool":
      return { action, tool: optionalString(message.tool) } as RuntimeMessage;
    case "openInSidebar":
      return {
        action,
        tool: optionalString(message.tool),
        mode: optionalString(message.mode),
        tabId: optionalNumber(message.tabId),
      };
    case "sidePanelToggleResult":
      return {
        action,
        tabId: optionalNumber(message.tabId),
        status: optionalString(message.status),
        tool: optionalString(message.tool),
        error: optionalString(message.error),
        source: optionalString(message.source),
      };
    case "openToolWindowAt":
      return {
        action,
        tool: optionalString(message.tool),
        anchor: parseAnchorPoint(message.anchor),
      };
    case "resizeToolForTab":
      return {
        action,
        width: optionalNumber(message.width),
        height: optionalNumber(message.height),
      };
    case "openPreviewPopup":
      return {
        action,
        url: optionalString(message.url),
        x: optionalNumber(message.x),
        y: optionalNumber(message.y),
      };
    case "open-settings":
      return { action, section: optionalString(message.section) };
    case "toggleDebug":
      return { action, value: optionalBoolean(message.value) };
    case "generateQr":
      return {
        action,
        text: optionalString(message.text),
        size: optionalNumber(message.size),
      };
    case "copyToClipboard":
      return { action, text: optionalString(message.text) };
    case "checkSiteStatus":
      return { action, domain: optionalString(message.domain) };
    case "updateDisabledSites":
      return {
        action,
        sites: Array.isArray(message.sites) ? message.sites : undefined,
      };
    case "toggleCurrentSite":
      return {
        action,
        enabled: optionalBoolean(message.enabled),
        domain: optionalString(message.domain),
      };
    default:
      return null;
  }
}

function parseAnchorPoint(value: unknown): AnchorPoint {
  if (!isMessageRecord(value)) return {};
  return {
    x: optionalNumber(value.x),
    y: optionalNumber(value.y),
  };
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
