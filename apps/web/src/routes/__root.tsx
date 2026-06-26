import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        name: "description",
        content:
          "Volt combines a Chrome resale workflow with an iPhone scanner for fast research, capture, pricing, and listing prep.",
      },
      {
        name: "apple-itunes-app",
        content: "app-id=6771770148, app-clip-bundle-id=com.volt.mobile.Clip",
      },
      { title: "Volt - Chrome resale workflow with iPhone scanning" },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.svg",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const content = <Outlet />;
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
