import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ClipboardList, ImageIcon, ScanBarcode } from "lucide-react";

import { authConfigured } from "./app-providers";

const highlights = [
  {
    icon: ScanBarcode,
    title: "Every capture, everywhere",
    body: "Barcodes and OCR text land in your workspace the moment the phone accepts them.",
  },
  {
    icon: ImageIcon,
    title: "Listing photos on a real screen",
    body: "Review the shots you just took at full size instead of squinting at a viewfinder.",
  },
  {
    icon: ClipboardList,
    title: "One account, every surface",
    body: "The same sign-in powers Chrome, the iPhone app, and this dashboard.",
  },
];

/**
 * A split page: the dark half borrows the landing page's product section, the
 * light half hosts whichever Clerk flow the route needs.
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
      <section className="relative hidden overflow-hidden bg-zinc-950 px-12 py-16 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="dark-grid pointer-events-none absolute inset-0 opacity-40" />
        <div className="absolute -left-24 top-1/3 size-[32rem] rounded-full bg-emerald-500/20 blur-3xl" />

        <a href="/" className="relative flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="text-sm font-semibold">Volt</span>
        </a>

        <motion.div
          className="relative max-w-md"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-sm font-semibold text-emerald-300">
            Cloud scanner workspace
          </p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight">
            {title}
          </h2>
          <div className="mt-10 grid gap-6">
            {highlights.map((item) => (
              <div key={item.title} className="flex gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-[0.8rem] bg-white text-zinc-950">
                  <item.icon size={19} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-zinc-400">
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <p className="relative text-xs text-zinc-500">
          Volt is an independent resale workflow project.
        </p>
      </section>

      <section className="flex min-h-screen flex-col justify-center px-4 py-12 sm:px-8 lg:px-14">
        <a href="/" className="mb-10 flex items-center gap-2 lg:hidden">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="text-sm font-semibold">Volt</span>
        </a>
        <div className="mx-auto w-full max-w-[25rem]">
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
