import type { CaptureMode } from "./capture-url";
import type { PhotoMessage, ScanItem } from "./scanner-messages";

export type ScannerTransportMessage = ScanItem | PhotoMessage;

export type ClipRelayResult = {
  id: string;
  mode: CaptureMode;
  message: ScannerTransportMessage;
};

function makeRelayResultId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function makeClipRelayResult(mode: CaptureMode, message: ScannerTransportMessage): ClipRelayResult {
  return {
    id: makeRelayResultId(),
    mode,
    message,
  };
}

export function messageForClipRelayStatus(status: number) {
  if (status === 400) {
    return "Scan the Mobile Scanner QR in Chrome to pair again.";
  }

  if (status === 404) {
    return "The browser session expired. Start a new scan from Chrome and use the latest QR code.";
  }

  if (status === 409) {
    return "A result was already sent for this browser session. Start a new scan to send another result.";
  }

  return `The browser session returned ${status}. Keep the QR overlay open and try again.`;
}
