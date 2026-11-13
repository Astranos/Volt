import { useEffect, useState, type ReactNode } from "react";
import { motion, type Variants } from "motion/react";
import { Check, Chrome, History, ImageIcon, ScanBarcode, Smartphone } from "lucide-react";

import { authConfigured } from "./app-providers";

const highlights = [
  {
    icon: ScanBarcode,
    title: "Scan on your iPhone",
    body: "Barcodes, text, and photos sync to Chrome as you capture them.",
  },
  {
    icon: ImageIcon,
    title: "Review on a bigger screen",
    body: "Open photos at full size in Chrome or the dashboard.",
  },
  {
    icon: History,
    title: "Free, with 7-day history",
    body: "Every account gets every feature. Captures clear after 7 days.",
  },
];

const ease = [0.22, 1, 0.36, 1] as const;

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease } },
};

/**
 * A split page: the dark half shows what Volt does, the light half hosts
 * whichever Clerk flow the route needs.
 */
export function AuthPage({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  // Clerk's widgets render their own DOM, so they stay out of the prerendered
  // markup and mount only once the browser has taken over.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-zinc-950 px-12 py-12 text-white lg:flex lg:flex-col xl:px-16">
        <div className="pointer-events-none absolute -left-32 top-1/4 size-[36rem] rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-0 size-[28rem] rounded-full bg-emerald-400/10 blur-3xl" />

        <a href="/" className="relative flex w-fit items-center gap-2">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="text-sm font-semibold">Volt</span>
        </a>

        <motion.div
          className="relative my-auto max-w-lg py-12"
          variants={stagger}
          initial="hidden"
          animate="visible"
        >
          <motion.h2
            variants={rise}
            className="text-4xl font-semibold leading-[1.1] tracking-tight xl:text-[2.75rem]"
          >
            {title}
          </motion.h2>

          <motion.div variants={rise} className="mt-10">
            <CaptureFlow />
          </motion.div>

          <motion.ul variants={stagger} className="mt-10 grid gap-5">
            {highlights.map((item) => (
              <motion.li key={item.title} variants={rise} className="flex gap-3.5">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-emerald-300">
                  <item.icon size={17} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="mt-0.5 text-sm leading-6 text-zinc-400">{item.body}</p>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        <p className="relative text-xs text-zinc-500">
          Volt is an independent resale workflow project.
        </p>
      </section>

      <section className="relative flex min-h-screen flex-col justify-center px-4 py-12 sm:px-8 lg:px-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_0%,rgba(16,185,129,0.10),transparent),radial-gradient(ellipse_50%_35%_at_100%_100%,rgba(16,185,129,0.06),transparent)]" />
        <a href="/" className="relative mb-10 flex items-center gap-2 lg:hidden">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="text-sm font-semibold">Volt</span>
        </a>
        <div className="relative mx-auto w-full max-w-[25rem]">
          {!authConfigured ? (
            <AuthUnavailable />
          ) : mounted ? (
            children
          ) : (
            <div className="h-[26rem] animate-pulse rounded-[1.2rem] bg-zinc-200/60" />
          )}
        </div>
      </section>
    </main>
  );
}

/** A capture leaving the iPhone and landing in Chrome, drawn in markup. */
function CaptureFlow() {
  return (
    <div aria-hidden="true" className="relative">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3.5 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-400 text-zinc-950">
          <Smartphone size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Barcode · iPhone
          </p>
          <p className="truncate font-mono text-sm text-white">883929739929</p>
        </div>
        <span className="text-[11px] text-zinc-500">now</span>
      </div>

      <div className="relative ml-8 h-8 w-px bg-gradient-to-b from-emerald-400/70 to-emerald-400/10">
        <motion.span
          className="absolute -left-[3px] size-[7px] rounded-full bg-emerald-300 shadow-[0_0_12px_2px_rgba(110,231,183,0.6)]"
          initial={{ top: 0, opacity: 0 }}
          animate={{ top: ["0%", "100%"], opacity: [0, 1, 0] }}
          transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.6 }}
        />
      </div>

      <div className="ml-6 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/80 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="flex items-center gap-2 border-b border-white/10 px-3.5 py-2">
          <span className="size-2 rounded-full bg-white/15" />
          <span className="size-2 rounded-full bg-white/15" />
          <span className="size-2 rounded-full bg-white/15" />
          <span className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] text-zinc-400">
            <Chrome size={11} />
            your-store.myshopify.com/admin
          </span>
        </div>
        <div className="space-y-2.5 p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">UPC</p>
          <div className="flex items-center justify-between rounded-lg border border-emerald-400/40 bg-emerald-400/[0.08] px-3 py-2">
            <span className="font-mono text-sm text-white">883929739929</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
              <Check size={12} strokeWidth={3} />
              Inserted
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthUnavailable() {
  return (
    <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-sm font-semibold text-amber-900">
        Sign-in is not configured
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-800">
        This build was made without a Clerk publishable key, so accounts are
        unavailable. Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and rebuild.
      </p>
    </div>
  );
}
