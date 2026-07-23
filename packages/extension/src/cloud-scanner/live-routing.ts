import type { ComputerId, LiveTargetSelection } from "./workspace-types.ts";

export type ScannerDeliveryIntent =
  | { kind: "workspaceBatch" }
  | { kind: "cursorInsertion" }
  | { kind: "dictation" };

/** Workspace batches are broadcast by account scope; only ephemeral live work routes. */
export function selectedComputerForIntent(
  selection: LiveTargetSelection,
  intent: ScannerDeliveryIntent,
): ComputerId | null {
  return intent.kind === "workspaceBatch" ? null : selection.selectedComputerId;
}
