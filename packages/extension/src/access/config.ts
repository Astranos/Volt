const extensionEnv = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;

export const CLERK_PUBLISHABLE_KEY =
  extensionEnv?.WXT_CLERK_PUBLISHABLE_KEY?.trim() ?? "";

export const VOLT_FULL_APP_URL =
  extensionEnv?.WXT_VOLT_FULL_APP_URL?.trim() ||
  "https://apps.apple.com/us/app/volt-scanner/id6771770148";
