import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import {
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
import { api } from "../../../../../convex/_generated/api";
import type { HandbookEntry, HandbookEntryId, HandbookStep } from "../../domain/handbook";
import { addressLines, entryFields, fieldDisplayValue, mapsUrl, valueFormatOf, type HandbookField } from "../../domain/handbook-format";
import { parseHandbookMarkdown, type Inline } from "../../domain/handbook-markdown";
import { cn } from "../../lib/utils";
import "./handbook.css";

const COPIED_MS = 1500;
const REVEAL_MS = 5 * 60_000;

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

/**
 * A login as two labeled rows: the username (shown, with Copy) and the password
 * (hidden until revealed, with Copy). The password only ever comes from the reveal
 * mutation.
 */
export function SecretFields({ entry }: { entry: HandbookEntry }) {
  const { revealed, toggle, copySecret } = useHandbookSecret(entry._id);
  return (
    <div className="handbook-fields">
      {entry.username ? (
        <div className="handbook-field-item">
          <span className="handbook-field-text">
            <span className="handbook-field-name">Username</span>
            <span className="handbook-field-value">{entry.username}</span>
          </span>
          <span className="handbook-row-actions"><CopyButton getText={() => entry.username ?? ""} /></span>
        </div>
      ) : null}
      <div className="handbook-field-item">
        <span className="handbook-field-text">
          <span className="handbook-field-name">Password</span>
          <span className={cn("handbook-field-value", !revealed && "is-masked")}>{revealed ? revealed.secret : "••••••••"}</span>
        </span>
        <span className="handbook-row-actions">
          <button
            type="button"
            className="handbook-button is-icon"
            onClick={toggle}
            aria-label={revealed ? `Hide the ${entry.title} password` : `Reveal the ${entry.title} password`}
            title={revealed ? "Hide" : "Reveal"}
          >
            {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
          <CopyButton getText={copySecret} />
        </span>
      </div>
    </div>
  );
}

/** A value entry's values as labeled rows, each with Copy (and Open in Maps for addresses). */
export function ValueFields({ entry }: { entry: HandbookEntry }) {
  return (
    <div className="handbook-fields">
      {entryFields(entry).map((field, index) => (
        <div key={index} className="handbook-field-item">
          <span className="handbook-field-text">
            {field.label ? <span className="handbook-field-name">{field.label}</span> : null}
            <FieldText field={field} className="handbook-field-value" />
          </span>
          <span className="handbook-row-actions"><FieldActions field={field} /></span>
        </div>
      ))}
    </div>
  );
}

/** Labeled rows for a login or a multi-value entry. */
export function EntryFields({ entry }: { entry: HandbookEntry }) {
  return entry.kind === "secret" ? <SecretFields entry={entry} /> : <ValueFields entry={entry} />;
}

export function EntryIcon({ entry }: { entry: HandbookEntry }) {
  const title = entry.title.toLowerCase();
  const format = valueFormatOf(entry);
  const [Icon, tone] = entry.kind === "secret" ? [KeyRound, "violet"]
    : entry.kind === "guide" ? [ListChecks, "blue"]
      : entry.kind === "page" ? [FileText, "amber"]
        : /police|emergency/.test(title) ? [Siren, "red"]
          : format === "phone" || /phone|call|line/.test(title) ? [Phone, "green"]
            : format === "address" ? [MapPin, "sky"]
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

/** A value: an address on two lines (street, then city/state/ZIP); anything else wraps. */
export function FieldText({ field, className }: { field: HandbookField; className?: string }) {
  if (field.format === "address") {
    return (
      <span className={cn("handbook-value-text", className)}>
        {addressLines(field.value).map((line) => <span key={line} className="handbook-value-line">{line}</span>)}
      </span>
    );
  }
  return <span className={cn("handbook-value-text", className)}>{field.value}</span>;
}

/** Copy, plus "Open in Maps" for addresses. */
export function FieldActions({ field }: { field: HandbookField }) {
  return (
    <>
      {field.format === "address" ? (
        <a
          className="handbook-button is-icon"
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

/** A single-value entry's value. */
export function ValueText({ entry, className }: { entry: HandbookEntry; className?: string }) {
  const [field] = entryFields(entry);
  return field ? <FieldText field={field} className={className} /> : null;
}

/** A single-value entry's actions. */
export function ValueActions({ entry }: { entry: HandbookEntry }) {
  const [field] = entryFields(entry);
  return field ? <FieldActions field={field} /> : null;
}

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text": return <span key={index}>{node.text}</span>;
          case "code": return <code key={index} className="handbook-md-code">{node.text}</code>;
          case "bold": return <strong key={index}><InlineNodes nodes={node.children} /></strong>;
          case "italic": return <em key={index}><InlineNodes nodes={node.children} /></em>;
          case "link": return <a key={index} href={node.href} target="_blank" rel="noreferrer"><InlineNodes nodes={node.children} /></a>;
        }
      })}
    </>
  );
}

/** Renders a page's formatted content. Only the parsed subset is rendered; never raw HTML. */
export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="handbook-md">
      {parseHandbookMarkdown(source).map((block, index) => {
        if (block.type === "heading") {
          const Heading = (["h2", "h3", "h4"] as const)[block.level - 1];
          return <Heading key={index}><InlineNodes nodes={block.children} /></Heading>;
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
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index} className={cn(block.items.some((item) => item.checked !== undefined) && "is-checklist")}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className={cn(item.checked !== undefined && "is-check", item.checked && "is-checked")}>
                {item.checked !== undefined ? (
                  <span className="handbook-md-check" aria-label={item.checked ? "Done" : "Not done"}>
                    {item.checked ? <Check aria-hidden="true" /> : null}
                  </span>
                ) : null}
                <span><InlineNodes nodes={item.children} /></span>
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
