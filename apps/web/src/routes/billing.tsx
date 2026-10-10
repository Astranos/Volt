import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell";
import { AccountPlans } from "../components/billing/account-plans";
export const Route = createFileRoute("/billing")({ component: BillingPage });
function BillingPage() {
  return (
    <AppShell current="billing">
      <AccountPlans />
    </AppShell>
  );
}
