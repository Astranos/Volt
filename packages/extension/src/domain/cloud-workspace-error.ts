function rawErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function cloudWorkspaceErrorMessage(error: unknown) {
  const message = rawErrorMessage(error);

  if (
    message.includes("cloud workspace refused this session") ||
    message.includes("Authentication required")
  ) {
    return "Cloud scanner sync could not verify this account. Sign out and back in.";
  }

  return "Cloud scanner sync is temporarily unavailable.";
}
