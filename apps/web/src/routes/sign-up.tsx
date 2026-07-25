import { createFileRoute } from "@tanstack/react-router";
import { SignUp } from "@clerk/clerk-react";

import { AuthPage } from "../components/auth-page";

export const Route = createFileRoute("/sign-up")({
  component: SignUpPage,
});

function SignUpPage() {
  return (
    <AuthPage title="One account for Chrome, the iPhone app, and the web.">
      <SignUp
        routing="hash"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/dashboard"
      />
    </AuthPage>
  );
}
