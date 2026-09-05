import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { AppProviders } from "../components/app-providers";
import { PwaRegistration } from "../components/pwa-registration";
import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#09090b" },
      {
        name: "description",
        content:
          "Volt combines a Chrome resale workflow with an iPhone scanner for fast research, capture, pricing, and listing prep.",
      },
      { title: "Volt - Chrome resale workflow with iPhone scanning" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/app-icon-192.png" },
      {
        rel: "icon",
        href: "/favicon.svg",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const content = (
    <>
      <AppProviders>
        <Outlet />
      </AppProviders>
      <Analytics />
      <PwaRegistration />
    </>
  );
  if (typeof document !== "undefined") return content;
  return (
    <RootDocument>
      {content}
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="root">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
