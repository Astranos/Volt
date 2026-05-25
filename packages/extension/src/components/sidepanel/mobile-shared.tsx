import React from "react";
import {
  CheckCircle2,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  XCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { ScannerConnectionStatus } from "../../../../scanner-protocol/src";

type StatusTone = "default" | "active" | "success" | "warning" | "error";

const TONE_STYLES: Record<StatusTone, { pill: string; dot: string; text: string }> = {
  default: {
    pill: "bg-stone-100/80 border-stone-200/80 dark:bg-stone-800/60 dark:border-stone-700/60",
    dot: "bg-stone-400 dark:bg-stone-500",
    text: "text-stone-600 dark:text-stone-300",
  },
  active: {
    pill: "bg-sky-50/80 border-sky-200/80 dark:bg-sky-950/60 dark:border-sky-800/60",
    dot: "bg-sky-500 animate-pulse",
    text: "text-sky-700 dark:text-sky-300",
  },
  success: {
    pill: "bg-green-50/80 border-green-200/80 dark:bg-green-950/60 dark:border-green-800/60",
    dot: "bg-green-500",
    text: "text-green-700 dark:text-green-300",
  },
  warning: {
    pill: "bg-amber-50/80 border-amber-200/80 dark:bg-amber-950/60 dark:border-amber-800/60",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
  },
  error: {
    pill: "bg-red-50/80 border-red-200/80 dark:bg-red-950/60 dark:border-red-800/60",
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-300",
  },
};

export function StatusPill({
  tone = "default",
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <span
      className={cn(
        "liquid-glass-soft inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        styles.pill,
        styles.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", styles.dot)} />
      <span className="truncate">{children}</span>
    </span>
  );
}

export function ConnectionPill({
  status,
  error,
}: {
  status: ScannerConnectionStatus;
  error: string | null;
}) {
  switch (status) {
    case "creating":
      return <StatusPill tone="active">Setting up</StatusPill>;
    case "waiting":
      return <StatusPill tone="warning">Waiting to pair</StatusPill>;
    case "connected":
      return <StatusPill tone="success">Connected</StatusPill>;
    case "error":
      return <StatusPill tone="error">{error ?? "Error"}</StatusPill>;
    default:
      return <StatusPill tone="default">Disconnected</StatusPill>;
  }
}

export function MobileToolHeader({
  icon,
  title,
  subtitle,
  status,
  error,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  status: ScannerConnectionStatus;
  error: string | null;
}) {
  return (
    <div className="liquid-glass-soft concentric-xl m-3 flex items-center justify-between gap-3 px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="liquid-glass-soft flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-green-700 dark:text-green-300">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-stone-900 dark:text-stone-100">
            {title}
          </div>
          <div className="truncate text-[11px] text-stone-500 dark:text-stone-400">
            {subtitle}
          </div>
        </div>
      </div>
      <ConnectionPill status={status} error={error} />
    </div>
  );
}

export function QrPairingPanel({
  qrDataUrl,
  hint,
}: {
  qrDataUrl: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="liquid-glass concentric-xl relative w-full max-w-[280px] bg-white p-4 dark:bg-white">
        <img
          src={qrDataUrl}
          alt="Scan this QR code with the Volt mobile app"
          className="concentric-lg aspect-square w-full"
        />
        <div className="liquid-glass concentric-md absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-white p-2 dark:bg-white">
          <img
            src={chrome.runtime.getURL("/assets/icons/logo-128.png")}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-contain"
          />
        </div>
      </div>
      <p className="mt-3 max-w-[280px] text-center text-xs text-stone-500 dark:text-stone-400">
        {hint}
      </p>
    </div>
  );
}

export function PairingPlaceholder({ label }: { label: string }) {
  return (
    <div className="liquid-glass-soft concentric-xl flex aspect-square w-full max-w-[280px] flex-col items-center justify-center gap-3 border-dashed border-stone-300 px-6 text-stone-500 dark:border-stone-700 dark:text-stone-400">
      <Loader2 className="h-7 w-7 animate-spin text-stone-400 dark:text-stone-500" />
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

export function PairingHero({
  title,
  description,
  status,
  onAction,
  actionLabel,
  actionPending,
}: {
  title: string;
  description: string;
  status: ScannerConnectionStatus;
  onAction: () => void;
  actionLabel: string;
  actionPending?: boolean;
}) {
  const Icon =
    status === "connected"
      ? CheckCircle2
      : status === "error"
        ? XCircle
        : status === "waiting"
          ? QrCode
          : Smartphone;

  return (
    <div className="liquid-glass concentric-xl mx-auto flex w-full max-w-[320px] flex-col items-center p-5 text-center">
      <div className="liquid-glass-soft flex h-16 w-16 items-center justify-center rounded-full">
        <Icon className="h-7 w-7 text-green-700 dark:text-green-300" />
      </div>
      <div className="mt-4 text-base font-bold text-stone-900 dark:text-stone-100">
        {title}
      </div>
      <p className="mt-1 max-w-[260px] text-sm text-stone-500 dark:text-stone-400">
        {description}
      </p>
      <button
        type="button"
        onClick={onAction}
        disabled={actionPending}
        className={cn(
          "mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-green-600 text-sm font-bold text-green-50 shadow-sm shadow-green-700/20 transition",
          "hover:bg-green-700 active:scale-[0.99] disabled:opacity-50",
        )}
      >
        {actionPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {actionLabel}
      </button>
    </div>
  );
}

export function PrimaryActionButton({
  onClick,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-green-600 px-5 text-sm font-bold text-green-50 shadow-sm shadow-green-700/30 ring-1 ring-inset ring-green-500/40 transition dark:bg-green-500 dark:text-green-950 dark:shadow-green-900/40 dark:ring-green-300/30",
        "hover:bg-green-700 active:scale-[0.99] disabled:opacity-50 disabled:hover:bg-green-600 dark:hover:bg-green-400",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SecondaryActionButton({
  onClick,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "liquid-glass-soft inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-bold text-stone-700 transition dark:text-stone-200",
        "hover:bg-white/70 active:scale-[0.99] disabled:opacity-50 dark:hover:bg-white/10",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconChip({
  onClick,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "liquid-glass-soft inline-flex h-9 w-9 items-center justify-center rounded-full text-stone-700 transition dark:text-stone-200",
        "hover:bg-white/70 active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
