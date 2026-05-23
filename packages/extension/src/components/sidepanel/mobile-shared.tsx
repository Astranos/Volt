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
    pill: "bg-stone-100 border-stone-200",
    dot: "bg-stone-400",
    text: "text-stone-600",
  },
  active: {
    pill: "bg-sky-50 border-sky-200",
    dot: "bg-sky-500 animate-pulse",
    text: "text-sky-700",
  },
  success: {
    pill: "bg-green-50 border-green-200",
    dot: "bg-green-500",
    text: "text-green-700",
  },
  warning: {
    pill: "bg-amber-50 border-amber-200",
    dot: "bg-amber-500",
    text: "text-amber-700",
  },
  error: {
    pill: "bg-red-50 border-red-200",
    dot: "bg-red-500",
    text: "text-red-700",
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
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
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
    <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700 ring-1 ring-green-200">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-stone-900">{title}</div>
          <div className="truncate text-[11px] text-stone-500">{subtitle}</div>
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
      <div className="relative w-full max-w-[280px] rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
        <img
          src={qrDataUrl}
          alt="Scan this QR code with the Volt mobile app"
          className="aspect-square w-full"
        />
        <div className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border border-stone-200 bg-white p-2 shadow-md">
          <img
            src={chrome.runtime.getURL("/assets/icons/logo-128.png")}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-contain"
          />
        </div>
      </div>
      <p className="mt-3 max-w-[280px] text-center text-xs text-stone-500">{hint}</p>
    </div>
  );
}

export function PairingPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex aspect-square w-full max-w-[280px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-stone-300 bg-stone-50 px-6 text-stone-500">
      <Loader2 className="h-7 w-7 animate-spin text-stone-400" />
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
  const Icon = status === "connected" ? CheckCircle2 : status === "error" ? XCircle : status === "waiting" ? QrCode : Smartphone;

  return (
    <div className="mx-auto flex w-full max-w-[320px] flex-col items-center rounded-3xl border border-stone-200 bg-white p-5 text-center shadow-sm">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50 ring-1 ring-green-200">
        <Icon className="h-7 w-7 text-green-700" />
      </div>
      <div className="mt-4 text-base font-bold text-stone-900">{title}</div>
      <p className="mt-1 max-w-[260px] text-sm text-stone-500">{description}</p>
      <button
        type="button"
        onClick={onAction}
        disabled={actionPending}
        className={cn(
          "mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-green-600 text-sm font-bold text-green-50 shadow-sm shadow-green-700/20 transition",
          "hover:bg-green-700 active:scale-[0.99] disabled:opacity-50",
        )}
      >
        {actionPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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
        "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-green-600 px-5 text-sm font-bold text-green-50 shadow-sm shadow-green-700/20 transition",
        "hover:bg-green-700 active:scale-[0.99] disabled:opacity-50 disabled:hover:bg-green-600",
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
        "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-stone-300 bg-white px-5 text-sm font-bold text-stone-700 transition",
        "hover:bg-stone-50 active:scale-[0.99] disabled:opacity-50",
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
        "inline-flex h-9 w-9 items-center justify-center rounded-full text-stone-700 transition",
        "hover:bg-stone-100 active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
