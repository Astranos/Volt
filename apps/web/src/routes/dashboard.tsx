import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell";
import { WorkspaceView } from "../components/dashboard/workspace-view";
import { WorkspaceAccess } from "../components/workspace-access";

export const Route = createFileRoute("/dashboard")({ component: DashboardPage });

function DashboardPage() {
  return (
    <AppShell current="workspace">
      <WorkspaceAccess>
        <WorkspaceView />
      </WorkspaceAccess>
    </AppShell>
  );
}
