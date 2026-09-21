import { type SignalRouteCommand } from "../scannerSignal/routeCommands";
import { type SignalRequestBody } from "../scannerSignal/httpAdapter";
import {
  type ScannerSignalLogFields,
  scannerSignalRouteTemplate,
  scannerSignalIdTail,
  logScannerSignalEvent,
  scannerSignalEventForCommand,
} from "../scannerSignal/logging";
import { objectFrom, stringField, jsonResponse } from "./shared";

function scannerSignalLogFields(
  command: SignalRouteCommand,
  parts: string[],
  body: SignalRequestBody,
  responseBody: unknown,
  statusCode: number,
  startedAt: number,
): ScannerSignalLogFields {
  const response = objectFrom(responseBody);
  const attempt = objectFrom(response.attempt);
  const request = objectFrom(response.request);
  const requests = Array.isArray(response.requests) ? response.requests : undefined;
  const isPairingIdRoute = parts[0] === "pairings" && parts[1] !== "reconnect-requests";

  return {
    route: scannerSignalRouteTemplate(command),
    command,
    statusCode,
    elapsedMs: Date.now() - startedAt,
    tokenTail: scannerSignalIdTail(parts[0] === "join-token" ? parts[1] : response.token ?? response.joinToken),
    attemptIdTail: scannerSignalIdTail(parts[3] ?? attempt.id),
    pairingIdTail: scannerSignalIdTail((isPairingIdRoute ? parts[1] : undefined) ?? response.pairingId ?? body.pairingId),
    requestIdTail: scannerSignalIdTail(parts[3] ?? request.id ?? response.requestId),
    browserSessionIdTail: scannerSignalIdTail(response.browserSessionId ?? body.browserSessionId ?? body.sessionId),
    requestCount: requests?.length,
  };
}

function rejectionReason(responseBody: unknown) {
  const reason = stringField(responseBody, "error");
  return reason ? reason.slice(0, 120) : undefined;
}

function logScannerSignalResponse(
  command: SignalRouteCommand,
  parts: string[],
  body: SignalRequestBody,
  responseBody: unknown,
  statusCode: number,
  startedAt: number,
) {
  const fields = scannerSignalLogFields(command, parts, body, responseBody, statusCode, startedAt);
  if (statusCode >= 400) {
    logScannerSignalEvent("signal_rejected", { ...fields, reason: rejectionReason(responseBody) }, "warn");
    return;
  }

  const event = scannerSignalEventForCommand(command);
  if (event) logScannerSignalEvent(event, fields);
}

export async function runAndRespond<T extends { statusCode: number; body: unknown }>(
  result: Promise<T>,
  logContext?: {
    command: SignalRouteCommand;
    parts: string[];
    requestBody: SignalRequestBody;
    startedAt: number;
  },
) {
  const response = await result;
  if (logContext) {
    logScannerSignalResponse(
      logContext.command,
      logContext.parts,
      logContext.requestBody,
      response.body,
      response.statusCode,
      logContext.startedAt,
    );
  }
  return jsonResponse(response.body, response.statusCode);
}
