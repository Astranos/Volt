import type { SignalRouteCommand } from "./routeCommands";

export type ScannerSignalEventName =
  | "join_token_created"
  | "join_attempt_created"
  | "offer_posted"
  | "answer_posted"
  | "pairing_registered"
  | "reconnect_request_created"
  | "push_wake_sent"
  | "push_wake_failed"
  | "reconnect_requests_fetched"
  | "reconnect_join_window_posted"
  | "signal_rejected";

export type ScannerSignalLogFields = {
  route?: string;
  command?: SignalRouteCommand;
  statusCode?: number;
  elapsedMs?: number;
  tokenTail?: string;
  attemptIdTail?: string;
  pairingIdTail?: string;
  requestIdTail?: string;
  browserSessionIdTail?: string;
  pushStatusCode?: number;
  reason?: string;
  requestCount?: number;
};

type ScannerSignalLogLevel = "info" | "warn";

const LOG_PREFIX = "[Volt Scanner Signal]";
const ID_TAIL_LENGTH = 8;

export function scannerSignalIdTail(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > ID_TAIL_LENGTH ? value.slice(-ID_TAIL_LENGTH) : `len:${value.length}`;
}

export function scannerSignalRouteTemplate(command: SignalRouteCommand) {
  switch (command) {
    case "createJoinToken":
      return "/api/signal/join-token";
    case "getJoinTokenStatus":
      return "/api/signal/join-token/:token";
    case "revokeJoinToken":
      return "/api/signal/join-token/:token/revoke";
    case "rotateJoinToken":
      return "/api/signal/join-token/:token/rotate";
    case "listJoinAttempts":
      return "/api/signal/join-token/:token/attempts";
    case "createJoinAttempt":
      return "/api/signal/join-token/:token/attempt";
    case "postJoinOffer":
      return "/api/signal/join-token/:token/attempt/:attemptId/offer";
    case "getJoinOffer":
      return "/api/signal/join-token/:token/attempt/:attemptId/offer";
    case "postJoinAnswer":
      return "/api/signal/join-token/:token/attempt/:attemptId/answer";
    case "getJoinAnswer":
      return "/api/signal/join-token/:token/attempt/:attemptId/answer";
    case "registerPairing":
      return "/api/signal/pairings";
    case "getPendingReconnectRequests":
      return "/api/signal/pairings/reconnect-requests";
    case "createReconnectRequest":
      return "/api/signal/pairings/:pairingId/reconnect";
    case "getReconnectRequestStatus":
      return "/api/signal/pairings/:pairingId/reconnect/:requestId";
    case "postReconnectJoinWindow":
      return "/api/signal/pairings/:pairingId/reconnect/:requestId/join-window";
    case "getIceServers":
      return "/api/signal/ice-servers";
    case "getPushPublicKey":
      return "/api/signal/push/public-key";
    case "notFound":
      return "/api/signal/:unknown";
  }
}

export function scannerSignalEventForCommand(command: SignalRouteCommand): ScannerSignalEventName | undefined {
  switch (command) {
    case "createJoinToken":
      return "join_token_created";
    case "createJoinAttempt":
      return "join_attempt_created";
    case "postJoinOffer":
      return "offer_posted";
    case "postJoinAnswer":
      return "answer_posted";
    case "registerPairing":
      return "pairing_registered";
    case "createReconnectRequest":
      return "reconnect_request_created";
    case "getPendingReconnectRequests":
      return "reconnect_requests_fetched";
    case "postReconnectJoinWindow":
      return "reconnect_join_window_posted";
    default:
      return undefined;
  }
}

export function logScannerSignalEvent(
  event: ScannerSignalEventName,
  fields: ScannerSignalLogFields = {},
  level: ScannerSignalLogLevel = "info",
) {
  const entry = Object.fromEntries(
    Object.entries({ event, ...fields }).filter(([, value]) => value !== undefined),
  );
  console[level](LOG_PREFIX, entry);
}
