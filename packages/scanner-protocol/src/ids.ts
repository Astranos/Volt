export const SCANNER_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;
export const SCANNER_JOIN_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,160}$/;
export const SCANNER_JOIN_ATTEMPT_ID_PATTERN = /^[a-zA-Z0-9_-]{12,80}$/;
export const SCANNER_CONTRIBUTOR_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
export const SCANNER_PAIRING_ID_PATTERN = /^[a-zA-Z0-9_-]{12,120}$/;

export function isScannerSessionId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_SESSION_ID_PATTERN.test(value);
}

export function isScannerJoinToken(value: unknown): value is string {
  return typeof value === "string" && SCANNER_JOIN_TOKEN_PATTERN.test(value);
}

export function isScannerJoinAttemptId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_JOIN_ATTEMPT_ID_PATTERN.test(value);
}

export function isScannerContributorId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_CONTRIBUTOR_ID_PATTERN.test(value);
}

export function isScannerPairingId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_PAIRING_ID_PATTERN.test(value);
}
