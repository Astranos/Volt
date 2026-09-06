import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell";
import { WorkspaceView } from "../components/dashboard/workspace-view";
import { WorkspaceAccess } from "../components/workspace-access";

export const Route = createFileRoute("/scanner-results")({
  component: ScannerResultsPage,
});

function ScannerResultsPage() {
  return (
    <AppShell current="scanner-results">
      <WorkspaceAccess>
        <WorkspaceView />
      </WorkspaceAccess>
    </AppShell>
  );
}
