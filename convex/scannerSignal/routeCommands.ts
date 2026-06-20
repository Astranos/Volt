export type SignalRouteCommand =
  | "createJoinToken"
  | "getJoinTokenStatus"
  | "revokeJoinToken"
  | "rotateJoinToken"
  | "listJoinAttempts"
  | "createJoinAttempt"
  | "postJoinOffer"
  | "getJoinOffer"
  | "postJoinAnswer"
  | "getJoinAnswer"
  | "registerPairing"
  | "getPendingReconnectRequests"
  | "createReconnectRequest"
  | "getReconnectRequestStatus"
  | "postReconnectJoinWindow"
  | "getPushPublicKey"
  | "notFound";

export function signalRouteCommand(method: string, parts: string[]): SignalRouteCommand {
  if (method === "POST" && parts.length === 1 && parts[0] === "join-token") return "createJoinToken";

  if (parts[0] === "join-token" && parts.length >= 2) {
    if (method === "GET" && parts.length === 2) return "getJoinTokenStatus";
    if (method === "POST" && parts[2] === "revoke" && parts.length === 3) return "revokeJoinToken";
    if (method === "POST" && parts[2] === "rotate" && parts.length === 3) return "rotateJoinToken";
    if (method === "GET" && parts[2] === "attempts" && parts.length === 3) return "listJoinAttempts";
    if (method === "POST" && parts[2] === "attempt" && parts.length === 3) return "createJoinAttempt";
    if (parts[2] === "attempt" && parts.length === 5) {
      if (parts[4] === "offer" && method === "POST") return "postJoinOffer";
      if (parts[4] === "offer" && method === "GET") return "getJoinOffer";
      if (parts[4] === "answer" && method === "POST") return "postJoinAnswer";
      if (parts[4] === "answer" && method === "GET") return "getJoinAnswer";
    }
  }

  if (parts[0] === "pairings") {
    if (method === "POST" && parts.length === 1) return "registerPairing";
    if (method === "GET" && parts[1] === "reconnect-requests" && parts.length === 2) {
      return "getPendingReconnectRequests";
    }
    if (method === "POST" && parts[2] === "reconnect" && parts.length === 3) return "createReconnectRequest";
    if (method === "GET" && parts[2] === "reconnect" && parts.length === 4) return "getReconnectRequestStatus";
    if (method === "POST" && parts[2] === "reconnect" && parts[4] === "join-window" && parts.length === 5) {
      return "postReconnectJoinWindow";
    }
  }

  if (parts[0] === "push" && parts[1] === "public-key" && method === "GET" && parts.length === 2) {
    return "getPushPublicKey";
  }

  return "notFound";
}
