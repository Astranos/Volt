export function scheduleRecognitionRestart({
  timers, peerId, isActive, restart, delay,
}: {
  timers: Map<string, number>;
  peerId: string;
  isActive: () => boolean;
  restart: () => void;
  delay: number;
}) {
  if (!isActive() || timers.has(peerId)) return;
  const timer = window.setTimeout(() => {
    if (timers.get(peerId) !== timer) return;
    timers.delete(peerId);
    if (isActive()) restart();
  }, delay);
  timers.set(peerId, timer);
}
