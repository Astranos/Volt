export type ExtensionMessageSender = {
  id?: string;
  url?: string;
};

export function isTrustedExtensionPageSender(
  sender: ExtensionMessageSender,
  extensionId: string,
  allowedPaths: readonly string[],
) {
  if (sender.id !== extensionId || typeof sender.url !== "string") return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === "chrome-extension:" &&
      url.host === extensionId &&
      allowedPaths.includes(url.pathname)
    );
  } catch {
    return false;
  }
}
