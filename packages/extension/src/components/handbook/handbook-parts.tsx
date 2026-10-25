import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  ListChecks,
  MapPin,
  Phone,
  Siren,
  StickyNote,
  TriangleAlert,
} from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import type { HandbookEntry, HandbookEntryId, HandbookStep } from "../../domain/handbook";
import { cn } from "../../lib/utils";
import "./handbook.css";

const COPIED_MS = 1500;
const REVEAL_MS = 30_000;

export function CopyButton({
  getText,
  label = "Copy",
  className,
}: {
  getText: () => string | Promise<string>;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await getText());
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), COPIED_MS);
  };

  return (
    <button type="button" className={cn("handbook-button", className)} onClick={() => void copy()}>
      {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{state === "copied" ? "Copied" : state === "failed" ? "Failed" : label}</span>
    </button>
  );
}

/**
 * Fetches one secret entry's login on demand through the reveal mutation and
 * forgets it again after a short time.
 */
export function useHandbookSecret(id: HandbookEntryId) {
  const revealSecret = useMutation(api.handbook.revealSecret);
  // Tagged with the entry it belongs to, so a reused component never shows one
  // entry's login under another, even if a reveal resolves after switching.
  const [state, setState] = useState<{ id: HandbookEntryId; login: { username?: string; secret: string } } | null>(null);
  const revealed = state?.id === id ? state.login : null;
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const fetchSecret = () => revealSecret({ id });
  const reveal = async () => {
    const login = await fetchSecret();
    setState({ id, login });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState(null), REVEAL_MS);
  };
  return {
    revealed,
    toggle: () => (revealed ? setState(null) : void reveal()),
    copySecret: async () => (await fetchSecret()).secret,
  };
}

/** Masked login with reveal and copy. Copy always goes through the reveal mutation. */
export function SecretRow({ entry, children }: { entry: HandbookEntry; children: (parts: { value: ReactNode; actions: ReactNode }) => ReactNode }) {
  const { revealed, toggle, copySecret } = useHandbookSecret(entry._id);
  const value = revealed ? (
    <span className="handbook-mono">
      {revealed.username ? (
        <button
          type="button"
          className="handbook-inline-copy"
          title="Copy username"
          onClick={() => void navigator.clipboard.writeText(revealed.username ?? "")}
        >
          {revealed.username}
        </button>
      ) : null}
      {revealed.username ? " · " : null}
      {revealed.secret}
    </span>
  ) : (
    <span className="handbook-mono">{entry.secretPreview}</span>
  );
  const actions = (
    <>
      <button
        type="button"
        className="handbook-button is-icon"
        onClick={toggle}
        aria-label={revealed ? `Hide ${entry.title}` : `Reveal ${entry.title}`}
        title={revealed ? "Hide" : "Reveal"}
      >
        {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
      <CopyButton getText={copySecret} />
    </>
  );
  return <>{children({ value, actions })}</>;
}

export function EntryIcon({ entry }: { entry: HandbookEntry }) {
  const title = entry.title.toLowerCase();
  const [Icon, tone] = entry.kind === "secret" ? [KeyRound, "violet"]
    : entry.kind === "guide" ? [ListChecks, "blue"]
      : /police|emergency/.test(title) ? [Siren, "red"]
        : /phone|call|line/.test(title) ? [Phone, "green"]
          : /address|location/.test(title) ? [MapPin, "sky"]
            : [StickyNote, "stone"];
  return (
    <span className={`handbook-icon is-${tone}`} aria-hidden="true">
      <Icon />
    </span>
  );
}

export function Keycaps({ keys }: { keys: string[] }) {
  return (
    <span className="handbook-keys">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="handbook-keys-item">
          {index > 0 ? <span aria-hidden="true">+</span> : null}
          <kbd className="handbook-key">{key}</kbd>
        </span>
      ))}
    </span>
  );
}

export function CommandBlock({ command }: { command: string }) {
  return (
    <div className="handbook-command">
      <code>{command}</code>
      <CopyButton getText={() => command} className="is-dark" />
    </div>
  );
}

export function GuideWarning({ children }: { children: ReactNode }) {
  return (
    <div className="handbook-warning" role="note">
      <TriangleAlert aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function StepDetails({ step }: { step: HandbookStep }) {
  return (
    <>
      <p className="handbook-step-text">{step.text}</p>
      {step.keys?.length ? <Keycaps keys={step.keys} /> : null}
      {step.command ? <CommandBlock command={step.command} /> : null}
      {step.tip ? <p className="handbook-step-tip">{step.tip}</p> : null}
    </>
  );
}

export function StepNumber({ index, state, onClick }: { index: number; state: "done" | "current" | "upcoming"; onClick?: () => void }) {
  const content = state === "done" ? <Check aria-hidden="true" /> : index + 1;
  return onClick ? (
    <button
      type="button"
      className={`handbook-step-number is-${state}`}
      onClick={onClick}
      aria-label={state === "done" ? `Mark step ${index + 1} not done` : `Mark step ${index + 1} done`}
    >
      {content}
    </button>
  ) : (
    <span className={`handbook-step-number is-${state}`}>{content}</span>
  );
}

export function VariantToggle({
  labels,
  value,
  onChange,
}: {
  labels: string[];
  value: number;
  onChange: (index: number) => void;
}) {
  if (labels.length < 2) return null;
  return (
    <div className="handbook-segmented" role="tablist" aria-label="Method">
      {labels.map((label, index) => (
        <button
          key={`${label}-${index}`}
          type="button"
          role="tab"
          aria-selected={index === value}
          className={cn(index === value && "is-active")}
          onClick={() => onChange(index)}
        >
          {label || `Method ${index + 1}`}
        </button>
      ))}
    </div>
  );
}
