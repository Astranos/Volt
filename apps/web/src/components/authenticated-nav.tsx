type AuthenticatedDestination = "workspace" | "product-data" | "api-keys";

const destinations: ReadonlyArray<{
  id: AuthenticatedDestination;
  href: string;
  label: string;
}> = [
  { id: "workspace", href: "/dashboard", label: "Workspace" },
  { id: "product-data", href: "/catalog", label: "Product data" },
  { id: "api-keys", href: "/api-keys", label: "API keys" },
];

export function AuthenticatedNav({
  current,
}: {
  current: AuthenticatedDestination;
}) {
  return (
    <nav aria-label="Account" className="flex min-w-0 items-center gap-3">
      {destinations
        .filter((destination) => destination.id !== current)
        .map((destination) => (
          <a
            key={destination.id}
            href={destination.href}
            className="whitespace-nowrap rounded text-xs font-semibold text-zinc-600 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            {destination.label}
          </a>
        ))}
    </nav>
  );
}
