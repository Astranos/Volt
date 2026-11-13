import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";

export function StorageSummary() {
  const storage = useQuery(api.workspaceStorage.getUsage, {});
  if (!storage) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm">
      <span>
        Free scanner · {storage.recordsUsed.toLocaleString()} /{" "}
        {storage.recordsLimit.toLocaleString()} stored scans
        {storage.enabled
          ? ` · ${storage.retentionDays}-day history`
          : " · Pilot retention"}
      </span>
    </div>
  );
}
