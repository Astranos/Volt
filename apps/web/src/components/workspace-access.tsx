import { Component, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useConvexAuth, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Cloud, LoaderCircle } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { AccessStatus } from "../../../../convex/access";
import { mobileAppDownloadUrl } from "../site-chrome";

type AccessState =
  | { status: "loading" }
  | { status: "allowed" }
  | { status: "locked" }
  | { status: "error" };

export function workspaceAccessState(
  body: Pick<AccessStatus, "hasFullAppAccess" | "clerkUserId"> | { error: string },
  userId: string,
): AccessState {
  if (!("hasFullAppAccess" in body) || body.clerkUserId !== userId) {
    return { status: "error" };
  }
  return { status: body.hasFullAppAccess ? "allowed" : "locked" };
}

/** A new Clerk session must synchronize its entitlement before workspace reads. */
export function WorkspaceAccess({ children }: { children: ReactNode }) {
  const { userId, sessionId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  if (!isAuthenticated || !userId || !sessionId) {
    return (
      <WorkspaceAccessContent state={{ status: "loading" }} retry={() => {}} />
    );
  }
  return (
    <AuthenticatedWorkspaceAccess key={`${userId}:${sessionId}`} userId={userId}>
      {children}
    </AuthenticatedWorkspaceAccess>
  );
}

function AuthenticatedWorkspaceAccess({ children, userId }: {
  children: ReactNode;
  userId: string;
}) {
  const getStatus = useMutation(api.access.getStatus);
  const [state, setState] = useState<AccessState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void getStatus({}).then(
      (response) => {
        if (!active) return;
        setState(workspaceAccessState(response.body, userId));
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, getStatus, userId]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  };

  return (
    <WorkspaceAccessContent state={state} retry={retry}>
      <WorkspaceErrorBoundary key={attempt} retry={retry}>
        {children}
      </WorkspaceErrorBoundary>
    </WorkspaceAccessContent>
  );
}

/** Also catches a subscription expiring while an existing query is subscribed. */
export class WorkspaceErrorBoundary extends Component<
  { children: ReactNode; retry: () => void },
  { status: "ready" | "locked" | "error" }
> {
  state: { status: "ready" | "locked" | "error" } = { status: "ready" };

  static getDerivedStateFromError(error: unknown): {
    status: "locked" | "error";
  } {
    return {
      status: error instanceof ConvexError
        && error.data === "Volt Pro subscription or complimentary access required"
        ? "locked"
        : "error",
    };
  }

  render() {
    if (this.state.status === "ready") return this.props.children;
    return (
      <WorkspaceAccessContent
        state={{ status: this.state.status }}
        retry={this.props.retry}
      />
    );
  }
}

export function WorkspaceAccessContent({ state, retry, children }: {
  state: AccessState;
  retry: () => void;
  children?: ReactNode;
}) {
  if (state.status === "allowed") return children;
  if (state.status === "loading") {
    return (
      <div
        role="status"
        className="flex min-h-80 items-center justify-center gap-3 text-sm text-zinc-500"
      >
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
        Checking workspace access…
      </div>
    );
  }
  const locked = state.status === "locked";
  return (
    <section
      aria-labelledby="workspace-access-title"
      className="mx-auto my-8 max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:my-16 sm:p-10"
    >
      <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
        <Cloud aria-hidden="true" className="size-6" />
      </div>
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
        Cloud workspace
      </p>
      <h1
        id="workspace-access-title"
        className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950"
      >
        {locked
          ? "Your cloud workspace comes with Volt Pro"
          : "We couldn't load your workspace"}
      </h1>
      <p className="mt-4 text-sm leading-6 text-zinc-600">
        {locked
          ? "Save captures across devices, search your history, and export results with a Volt Pro subscription or complimentary access. This account doesn't have cloud workspace access yet."
          : "We couldn't confirm access or load your captures. Check your connection and try again."}
      </p>
      {locked ? (
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Manage your subscription in the Volt iPhone app, then check access
          again. Already subscribed? Make sure you're signed in to the same account.
        </p>
      ) : null}
      <div className="mt-7 flex flex-wrap gap-3">
        {locked ? (
          <a
            href={mobileAppDownloadUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            Get Volt for iPhone
            <span className="sr-only">, opens in a new tab</span>
          </a>
        ) : null}
        <button
          type="button"
          onClick={retry}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        >
          {locked ? "Check access again" : "Try again"}
        </button>
      </div>
    </section>
  );
}
