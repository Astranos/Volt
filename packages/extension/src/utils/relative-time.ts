/**
 * Format a Date or epoch (seconds OR milliseconds) as a short relative time
 * like "just now", "5m", "2h", "3d", "Mar 4".
 */
export function formatRelativeTime(
  input: number | Date | undefined,
  now: number = Date.now()
): string {
  if (input == null) return "";

  let ms: number;
  if (input instanceof Date) {
    ms = input.getTime();
  } else if (typeof input === "number") {
    // chrome.sessions.Session#lastModified is in seconds; normalize.
    ms = input < 1e12 ? input * 1000 : input;
  } else {
    return "";
  }

  const diffSeconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (diffSeconds < 30) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  const date = new Date(ms);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
