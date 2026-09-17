import { useEffect, useRef, useState } from "react";

export function useIdleReset(reset: () => void) {
  const lastActivity = useRef(Date.now());
  const resetRef = useRef(reset);
  resetRef.current = reset;
  const [remaining, setRemaining] = useState<number | null>(null);
  const keepBrowsing = () => {
    lastActivity.current = Date.now();
    setRemaining(null);
  };
  useEffect(() => {
    const activity = () => {
      lastActivity.current = Date.now();
      setRemaining(null);
    };
    const events = ["pointerdown", "keydown", "scroll"];
    events.forEach((event) =>
      window.addEventListener(event, activity, { passive: true, capture: true }),
    );
    const timer = window.setInterval(() => {
      const seconds = Math.ceil(
        (120_000 - (Date.now() - lastActivity.current)) / 1000,
      );
      if (seconds <= 0) {
        resetRef.current();
        activity();
      } else setRemaining(seconds <= 20 ? seconds : null);
    }, 1000);
    return () => {
      window.clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, activity, true));
    };
  }, []);
  return { remaining, keepBrowsing };
}
