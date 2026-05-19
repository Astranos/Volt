import { useEffect, useState } from "react";

interface HeroBlockProps {
  /** Optional name to personalize the greeting (e.g., "Good evening, Juan"). */
  name?: string;
}

function getGreeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function formatTime(date: Date): { time: string; period: string } {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const displayMinute = minutes.toString().padStart(2, "0");
  return { time: `${displayHour}:${displayMinute}`, period };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function HeroBlock({ name }: HeroBlockProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let intervalId: number | undefined;
    // Align the first tick to the start of the next minute so the clock stays accurate.
    const msUntilNextMinute = 60_000 - (Date.now() % 60_000);
    const timeoutId = window.setTimeout(() => {
      setNow(new Date());
      intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    }, msUntilNextMinute);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  const greeting = getGreeting(now.getHours());
  const { time, period } = formatTime(now);
  const dateLabel = formatDate(now);

  return (
    <div className="hero-block">
      <div className="hero-block-greeting">
        {greeting}
        {name ? `, ${name}` : ""}
      </div>
      <div className="hero-block-clock">
        <span className="hero-block-time">{time}</span>
        <span className="hero-block-period">{period}</span>
      </div>
      <div className="hero-block-date">{dateLabel}</div>
    </div>
  );
}
