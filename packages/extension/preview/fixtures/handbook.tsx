import { useMemo, type ReactNode } from "react";
import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { HandbookEntry } from "@/src/domain/handbook";

// Sample handbook. The logins are fake and only ever shown masked or as
// obviously placeholder text; real credentials never belong in fixtures.
const day = 86_400_000;
const now = Date.UTC(2026, 9, 18, 14, 30);
let order = 0;
const entry = (fields: Partial<HandbookEntry> & Pick<HandbookEntry, "kind" | "title" | "category">): HandbookEntry => ({
  _id: `preview${String(order).padStart(12, "0")}` as HandbookEntry["_id"],
  note: undefined,
  value: undefined,
  body: undefined,
  variants: undefined,
  secretPreview: undefined,
  pinned: false,
  order: order++,
  updatedAt: now - 3 * day,
  updatedByName: "Juan Q",
  ...fields,
});

export const handbookEntries: HandbookEntry[] = [
  entry({ kind: "value", title: "Store phone", category: "Store info", value: "555-0100", pinned: true }),
  entry({ kind: "value", title: "Store address", category: "Store info", note: "Next to the bank", value: "123 Main St", pinned: true }),
  entry({ kind: "value", title: "Local police", category: "Store info", note: "Non-emergency line", value: "555-0199" }),
  entry({ kind: "secret", title: "PSN", category: "Logins", note: "Testing consoles", secretPreview: "stor••• · ••••••", pinned: true }),
  entry({ kind: "secret", title: "Microsoft account", category: "Logins", note: "Testing PCs and Xbox", secretPreview: "stor••• · ••••••" }),
  entry({ kind: "secret", title: "Mac test user", category: "Logins", secretPreview: "u••• · ••••••" }),
  entry({
    kind: "guide",
    title: "Skip Windows sign-in",
    category: "Setup guides",
    body: "For Windows: no password.",
    pinned: true,
    variants: [
      {
        label: "New method (24H2+)",
        warning: "If the command does nothing, the build is too old. Switch to Older builds.",
        steps: [
          { text: "On the region / keyboard screen, don't connect to Wi-Fi." },
          { text: "Open Command Prompt.", keys: ["Shift", "Fn", "F10"], tip: "Fn is only needed on laptops where the F-keys are media keys." },
          { text: "Type this command and press Enter.", command: "start ms-cxh:localonly" },
          { text: "Create a local user named \"User\" with no password, then finish setup." },
        ],
      },
      {
        label: "Older builds",
        steps: [
          { text: "Before the internet screen, open Command Prompt.", keys: ["Shift", "F10"] },
          { text: "Type this in all caps and press Enter.", command: "OOBE\\BYPASSNRO" },
          { text: "The PC restarts. Go through setup as normal." },
          { text: "On the internet screen, click \"I don't have internet\", then \"Continue with limited setup\"." },
        ],
      },
    ],
  }),
  entry({ kind: "value", title: "Wipe checklist before listing", category: "Testing", value: "Sign out of iCloud, Google, and console accounts", updatedAt: now - day }),
];

export const handbookGuide = handbookEntries.find((item) => item.kind === "guide")!;

const fakeLogin = { username: "store01@example.com", secret: "Example-Pass-123" };

/** Replies for the New Tab and Command Menu, which reach Convex through the background. */
export const handbookMessages = {
  handbookList: () => ({ success: true, value: handbookEntries }),
  handbookRevealSecret: () => ({ success: true, value: fakeLogin }),
};

// Just enough of ConvexReactClient for the handbook hooks: always signed in,
// queries answer from the fixture, mutations resolve without a server.
function previewClient(entries: HandbookEntry[]) {
  const results: Record<string, unknown> = {
    "handbook:list": entries,
    "handbook:revealSecret": fakeLogin,
  };
  return {
    setAuth: (_fetchToken: unknown, onChange: (authenticated: boolean) => void) => onChange(true),
    clearAuth: () => {},
    watchQuery: (query: FunctionReference<"query">) => ({
      onUpdate: () => () => {},
      localQueryResult: () => results[getFunctionName(query)],
      journal: () => undefined,
    }),
    mutation: async (mutation: FunctionReference<"mutation">) => results[getFunctionName(mutation)] ?? null,
    action: async () => null,
  } as unknown as ConvexReactClient;
}

const signedIn = () => ({ isLoading: false, isAuthenticated: true, fetchAccessToken: async () => "preview" });

export function HandbookPreviewProvider({ entries = handbookEntries, children }: { entries?: HandbookEntry[]; children: ReactNode }) {
  const client = useMemo(() => previewClient(entries), [entries]);
  return <ConvexProviderWithAuth client={client} useAuth={signedIn}>{children}</ConvexProviderWithAuth>;
}
