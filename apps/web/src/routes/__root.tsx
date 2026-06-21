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
          "Volt pairs a mobile scanner app with a Chrome extension so product sellers can capture barcodes, label text, notes, and photos for desktop inventory workflows.",
      },
      { title: "Volt - Mobile product scanning for desktop workflows" },
    ],
    links: [
      {
        rel: "icon",
        href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>V</text></svg>",
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
