import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell";
import { DashboardHome } from "../components/dashboard/dashboard-home";

export const Route = createFileRoute("/dashboard")({ component: DashboardPage });

function DashboardPage() {
  return (
    <AppShell current="workspace">
      <DashboardHome />
    </AppShell>
  );
}
