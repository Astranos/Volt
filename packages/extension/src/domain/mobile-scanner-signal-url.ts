import { SCANNER_SIGNAL_URL_DEV, SCANNER_SIGNAL_URL_PROD } from "@volt/scanner-protocol";

const extensionEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const configuredSignalUrl = extensionEnv?.WXT_SCANNER_SIGNAL_URL;

export const EXTENSION_SCANNER_SIGNAL_URL =
  typeof configuredSignalUrl === "string" && configuredSignalUrl.length > 0
    ? configuredSignalUrl
    : extensionEnv?.MODE === "production"
      ? SCANNER_SIGNAL_URL_PROD
      : SCANNER_SIGNAL_URL_DEV;
