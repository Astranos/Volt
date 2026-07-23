import type { ScannerProtocolErrorCode } from "@volt/scanner-protocol";
import type {
  MobileScannerSessionEvents,
  SessionReadyAccessDecision,
  UsageJoinWindow,
} from "./mobile-scanner-session-types";

type SessionReadyDecisionActions = {
  closePeer: () => Promise<void> | void;
  denySession: (detail: string) => void;
  sendProtocolError: (
    code: ScannerProtocolErrorCode,
    receivedType: string,
    detail: string,
  ) => void;
  sendSessionReady: () => void;
};

export async function applySessionReadyAccessDecision(
  decision: SessionReadyAccessDecision,
  actions: SessionReadyDecisionActions,
) {
  if (decision.allowed) {
    actions.sendSessionReady();
    return true;
  }

  const detail =
    decision.error ??
    "Scanner access is exhausted. Sign in or subscribe in the full iPhone app.";
  actions.sendProtocolError("access_exhausted", "hello", detail);
  actions.denySession(detail);
  await actions.closePeer();
  return false;
}

export async function authorizeSessionReady({
  actions,
  authorize,
  joinWindow,
}: {
  actions: SessionReadyDecisionActions;
  authorize: MobileScannerSessionEvents["onSessionReady"];
  joinWindow: UsageJoinWindow | null;
}) {
  const usageSessionId = joinWindow?.usageSessionId;
  if (authorize && (!joinWindow || !usageSessionId)) {
    const detail = "Scanner access could not be verified. Create a new QR code.";
    actions.sendProtocolError("invalid_state", "hello", detail);
    actions.denySession(detail);
    await actions.closePeer();
    return false;
  }
  const decision =
    authorize && joinWindow && usageSessionId
      ? await authorize({ joinToken: joinWindow.joinToken, usageSessionId })
      : { allowed: true };
  return applySessionReadyAccessDecision(decision, actions);
}
