import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import { getMobileScannerExtensionIdentity } from "../domain/mobile-scanner-identity";

export const COMPUTER_REGISTRATION_KEY = "volt.cloudScanner.computerRegistration.v1";
export const COMPUTER_REGISTRATION_TTL_MS = 120_000;
export const COMPUTER_REGISTRATION_INTERVAL_MS = 60_000;
export const COMPUTER_CAPABILITIES = [
  "workspace-results",
  "cursor-insertion",
  "photo-download",
];

export type ComputerRegistration = FunctionReturnType<
  typeof api.cloudWorkspace.registerComputer
>;

// Both the offscreen document's ConvexClient and the panel's ConvexReactClient
// satisfy this, and neither type needs to be imported to describe it.
export type ComputerRegistrationClient = {
  mutation: (
    reference: typeof api.cloudWorkspace.registerComputer,
    args: {
      installationId: string;
      label: string;
      capabilities: string[];
      ttlMs: number;
    },
  ) => Promise<ComputerRegistration>;
};

/**
 * Writes this computer's presence row so the phone can list it as online.
 *
 * The registration is keyed by the install id rather than by the calling
 * context, so two contexts registering the same computer refresh one row
 * instead of creating two.
 */
export async function registerComputer(
  client: ComputerRegistrationClient,
  chromeApi: typeof chrome = chrome,
): Promise<ComputerRegistration> {
  const identity = await getMobileScannerExtensionIdentity();
  const registration = await client.mutation(api.cloudWorkspace.registerComputer, {
    installationId: identity.installId,
    label: identity.sessionLabel,
    capabilities: COMPUTER_CAPABILITIES,
    ttlMs: COMPUTER_REGISTRATION_TTL_MS,
  });
  await chromeApi.storage.local.set({ [COMPUTER_REGISTRATION_KEY]: registration });
  return registration;
}
