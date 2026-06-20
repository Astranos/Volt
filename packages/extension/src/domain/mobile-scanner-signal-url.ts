import { SCANNER_SIGNAL_URL_DEV, SCANNER_SIGNAL_URL_PROD } from "../../../scanner-protocol/src";

const configuredSignalUrl = import.meta.env.WXT_SCANNER_SIGNAL_URL;

export const EXTENSION_SCANNER_SIGNAL_URL =
  typeof configuredSignalUrl === "string" && configuredSignalUrl.length > 0
    ? configuredSignalUrl
    : import.meta.env.MODE === "production"
      ? SCANNER_SIGNAL_URL_PROD
      : SCANNER_SIGNAL_URL_DEV;
