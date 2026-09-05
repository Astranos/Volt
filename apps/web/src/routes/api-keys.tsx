import { createFileRoute } from "@tanstack/react-router";
import { ApiKeyManager } from "../components/api-keys/api-key-manager";
import { AppShell } from "../components/app-shell";

export const Route = createFileRoute("/api-keys")({ component: ApiKeysPage });

function ApiKeysPage() {
  return <AppShell current="api-keys"><ApiKeyManager /></AppShell>;
}
