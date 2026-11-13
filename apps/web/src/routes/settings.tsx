import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "../components/app-shell";
import { SettingsPage } from "../components/settings/settings-page";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

function SettingsRoute() {
  return (
    <AppShell current="settings">
      <SettingsPage />
    </AppShell>
  );
}
