import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import {
  BookOpen,
  Check,
  Copy,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  ListChecks,
  MapPin,
  Navigation,
  Phone,
  Siren,
  StickyNote,
  TriangleAlert,
} from "lucide-react";
import {
  addressLines,
  entryFields,
  fieldDisplayValue,
  mapsUrl,
  parseHandbookMarkdown,
  valueFormatOf,
  type HandbookEntry,
  type HandbookEntryId,
  type HandbookField,
  type HandbookStep,
  type Inline,
} from "@volt/handbook";

import { api } from "../../../../../convex/_generated/api";

const COPIED_MS = 1500;
// A revealed password hides itself again after this long.
const REVEAL_MS = 5 * 60_000;

export const buttonClass =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[0.7rem] border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-3.5";
export const iconButtonClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent [&_svg]:size-4";
export const primaryButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[0.85rem] bg-zinc-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4";

export function CopyButton({
  getText,
  label = "Copy",
  dark = false,
}: {
  getText: () => string | Promise<string>;
  label?: string;
  dark?: boolean;
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
    <button
      type="button"
      onClick={() => void copy()}
      className={
        dark
          ? "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs font-semibold text-zinc-100 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 [&_svg]:size-3.5"
          : `${buttonClass} ${state === "copied" ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50" : ""}`
      }
    >
      {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Failed" : label}</span>
    </button>
  );
}

/**
 * Fetches one login on demand through the reveal mutation and forgets it again after a
 * short time. Passwords never come from the list query.
 */
function useHandbookSecret(id: HandbookEntryId) {
  const revealSecret = useMutation(api.handbook.revealSecret);
  // Tagged with its entry, so a reveal that resolves after switching entries is ignored.
  const [state, setState] = useState<{ id: HandbookEntryId; login: { username?: string; secret: string } } | null>(null);
  const [error, setError] = useState(false);
  const revealed = state?.id === id ? state.login : null;
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  // Each reveal or hide starts a new request generation; only the latest reveal may show
  // a password, so a slow response can't re-show one after it was hidden.
  const generation = useRef(0);

  const fetchSecret = () => revealSecret({ id });
  const hide = () => {
    generation.current += 1;
    setState(null);
  };
  const reveal = async () => {
    const current = ++generation.current;
    setError(false);
    try {
      const login = await fetchSecret();
      if (current !== generation.current) return;
      setState({ id, login });
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(hide, REVEAL_MS);
    } catch {
      if (current === generation.current) setError(true);
    }
  };
  return {
    revealed,
    error,
    toggle: () => (revealed ? hide() : void reveal()),
    copySecret: async () => (await fetchSecret()).secret,
  };
}

function FieldRow({ label, children, actions }: { label?: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        {label ? <p className="text-xs font-medium text-zinc-500">{label}</p> : null}
        <div className="mt-0.5 break-words text-sm font-semibold text-zinc-950">{children}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </div>
  );
}

/** A login: the username (shown) and the password (hidden until revealed). */
export function SecretFields({ entry }: { entry: HandbookEntry }) {
  const { revealed, error, toggle, copySecret } = useHandbookSecret(entry._id);
  return (
    <div className="divide-y divide-zinc-100">
      {entry.username ? (
        <FieldRow label="Username" actions={<CopyButton getText={() => entry.username ?? ""} />}>
          {entry.username}
        </FieldRow>
      ) : null}
      <FieldRow
        label="Password"
        actions={
          <>
            <button
              type="button"
              className={iconButtonClass}
              onClick={toggle}
              aria-label={revealed ? `Hide the ${entry.title} password` : `Reveal the ${entry.title} password`}
              title={revealed ? "Hide" : "Reveal"}
            >
              {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
            <CopyButton getText={copySecret} />
          </>
        }
      >
        {revealed ? (
          <span className="font-mono">{revealed.secret}</span>
        ) : (
          <span className="tracking-[0.2em] text-zinc-400" aria-label="Hidden">••••••••</span>
        )}
        {error ? <span className="ml-2 text-xs font-medium text-red-600">Couldn't reveal it. Try again.</span> : null}
      </FieldRow>
    </div>
  );
}

/** A value: an address on two lines (street, then city/state/ZIP); anything else wraps. */
export function FieldText({ field }: { field: HandbookField }) {
  if (field.format === "address") {
    return <>{addressLines(field.value).map((line) => <span key={line} className="block">{line}</span>)}</>;
  }
  return <span className="whitespace-pre-wrap">{field.value}</span>;
}

/** Copy, plus "Open in Maps" for addresses. */
export function FieldActions({ field }: { field: HandbookField }) {
  return (
    <>
      {field.format === "address" ? (
        <a
          className={iconButtonClass}
          href={mapsUrl(fieldDisplayValue(field))}
          target="_blank"
          rel="noreferrer"
          aria-label="Open in Google Maps"
          title="Open in Google Maps"
        >
          <Navigation aria-hidden="true" />
        </a>
      ) : null}
      <CopyButton getText={() => fieldDisplayValue(field)} />
    </>
  );
}

/** A quick value's values, each with Copy. */
export function ValueFields({ entry }: { entry: HandbookEntry }) {
  return (
    <div className="divide-y divide-zinc-100">
      {entryFields(entry).map((field, index) => (
        <FieldRow key={index} label={field.label} actions={<FieldActions field={field} />}>
          <FieldText field={field} />
        </FieldRow>
      ))}
    </div>
  );
}

const ICON_TONES = {
  violet: "bg-violet-50 text-violet-700",
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  green: "bg-emerald-50 text-emerald-700",
  sky: "bg-sky-50 text-sky-700",
  stone: "bg-zinc-100 text-zinc-600",
} as const;

export function EntryIcon({ entry }: { entry: HandbookEntry }) {
  const title = entry.title.toLowerCase();
  const format = valueFormatOf(entry);
  const [Icon, tone] = entry.kind === "secret" ? [KeyRound, "violet"] as const
    : entry.kind === "guide" ? [ListChecks, "blue"] as const
      : entry.kind === "note" ? [FileText, "amber"] as const
        : /police|emergency/.test(title) ? [Siren, "red"] as const
          : format === "phone" || /phone|call|line/.test(title) ? [Phone, "green"] as const
            : format === "address" ? [MapPin, "sky"] as const
              : [StickyNote, "stone"] as const;
  return (
    <span className={`grid size-9 shrink-0 place-items-center rounded-[0.7rem] ${ICON_TONES[tone]}`} aria-hidden="true">
      <Icon className="size-[18px]" />
    </span>
  );
}

function Keycaps({ keys }: { keys: string[] }) {
  return (
    <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="flex items-center gap-1.5">
          {index > 0 ? <span aria-hidden="true">+</span> : null}
          <kbd className="rounded-md border border-b-2 border-zinc-200 bg-white px-2 py-0.5 font-sans text-xs font-semibold text-zinc-700">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  );
}

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="mt-2 flex items-center gap-3 rounded-[0.7rem] bg-zinc-950 py-2 pl-3 pr-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[13px] text-emerald-300">{command}</code>
      <CopyButton getText={() => command} dark />
    </div>
  );
}

export function GuideWarning({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" role="note">
      <TriangleAlert className="mt-1 size-4 shrink-0 text-amber-600" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** A guide's steps for one method. */
export function GuideSteps({ steps }: { steps: HandbookStep[] }) {
  return (
    <ol className="divide-y divide-zinc-100 overflow-hidden rounded-[1.2rem] border border-zinc-200 bg-white">
      {steps.map((step, index) => (
        <li key={index} className="flex gap-3.5 px-4 py-4 sm:px-5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-700">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm leading-6 text-zinc-900">{step.text}</p>
            {step.keys?.length ? <Keycaps keys={step.keys} /> : null}
            {step.command ? <CommandBlock command={step.command} /> : null}
            {step.tip ? <p className="mt-2 text-xs leading-5 text-zinc-500">{step.tip}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Tabs between a guide's methods ("New method", "Older builds"). Hidden with one method. */
export function VariantToggle({ labels, value, onChange }: { labels: string[]; value: number; onChange: (index: number) => void }) {
  if (labels.length < 2) return null;
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-[0.85rem] bg-zinc-100 p-1" role="tablist" aria-label="Method">
      {labels.map((label, index) => (
        <button
          key={`${label}-${index}`}
          type="button"
          role="tab"
          aria-selected={index === value}
          onClick={() => onChange(index)}
          className={`rounded-[0.6rem] px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${index === value ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-900"}`}
        >
          {label || `Method ${index + 1}`}
        </button>
      ))}
    </div>
  );
}

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text": return <span key={index}>{node.text}</span>;
          case "code": return <code key={index} className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] text-zinc-800">{node.text}</code>;
          case "bold": return <strong key={index} className="font-semibold text-zinc-950"><InlineNodes nodes={node.children} /></strong>;
          case "italic": return <em key={index}><InlineNodes nodes={node.children} /></em>;
          case "link": return (
            <a key={index} href={node.href} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800">
              <InlineNodes nodes={node.children} />
            </a>
          );
        }
      })}
    </>
  );
}

const HEADING_CLASSES = [
  "mt-6 text-lg font-semibold text-zinc-950 first:mt-0",
  "mt-5 text-base font-semibold text-zinc-950 first:mt-0",
  "mt-4 text-sm font-semibold text-zinc-950 first:mt-0",
];

/** Renders a note's formatted content. Only the parsed subset is rendered; never raw HTML. */
export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="space-y-3 text-sm leading-7 text-zinc-700">
      {parseHandbookMarkdown(source).map((block, index) => {
        if (block.type === "heading") {
          const Heading = (["h2", "h3", "h4"] as const)[block.level - 1];
          return <Heading key={index} className={HEADING_CLASSES[block.level - 1]}><InlineNodes nodes={block.children} /></Heading>;
        }
        if (block.type === "paragraph") {
          return (
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                <span key={lineIndex}>{lineIndex > 0 ? <br /> : null}<InlineNodes nodes={line} /></span>
              ))}
            </p>
          );
        }
        const checklist = block.items.some((item) => item.checked !== undefined);
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index} className={checklist ? "space-y-1.5" : `space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-zinc-400`}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className={item.checked !== undefined ? `flex items-start gap-2.5 ${item.checked ? "text-zinc-400 line-through" : ""}` : undefined}>
                {item.checked !== undefined ? (
                  <span
                    className={`mt-1.5 grid size-4 shrink-0 place-items-center rounded-[5px] border-[1.5px] ${item.checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300"}`}
                    role="img"
                    aria-label={item.checked ? "Done" : "Not done"}
                  >
                    {item.checked ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : null}
                  </span>
                ) : null}
                <span className="min-w-0"><InlineNodes nodes={item.children} /></span>
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

export function Notice({ title, copy, children }: { title: string; copy: string; children?: ReactNode }) {
  return (
    <div className="rounded-[1.35rem] border border-zinc-200 bg-white px-6 py-10 text-center sm:px-10">
      <span className="mx-auto grid size-12 place-items-center rounded-[0.9rem] bg-emerald-50 text-emerald-700">
        <BookOpen className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-zinc-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">{copy}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}
