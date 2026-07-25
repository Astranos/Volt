import { createFileRoute } from "@tanstack/react-router";
import { SignIn } from "@clerk/clerk-react";

import { AuthPage } from "../components/auth-page";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

function SignInPage() {
  return (
    <AuthPage title="Pick up your captures on any screen you happen to be at.">
      {/*
        Hash routing keeps Clerk's multi-step flows inside a single static
        route, which is all the Vercel catch-all rewrite can serve.
      */}
      <SignIn
        routing="hash"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/dashboard"
      />
    </AuthPage>
  );
}
