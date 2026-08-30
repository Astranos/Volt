import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  ClipboardCopy,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Terminal,
  Trash2,
} from "lucide-react";

import { api } from "../../../../../convex/_generated/api";
import { PRODUCT_DATA_API_ORIGIN } from "../../lib/env";

type ProductApiKey = FunctionReturnType<typeof api.productApiKeys.list>[number];
type CreatedProductApiKey = FunctionReturnType<typeof api.productApiKeys.create>;

type MutationState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "revoking"; id: ProductApiKey["id"] };

type CopyState =
  | { kind: "idle" }
  | { kind: "copied" }
  | { kind: "error"; message: string };

type OperationError =
  | { kind: "create"; message: string }
  | { kind: "revoke"; message: string };

const apiKeyNameMaxLength = 64;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function ApiKeyManager() {
  const apiKeys = useQuery(api.productApiKeys.list, {});
  const createApiKey = useMutation(api.productApiKeys.create);
  const revokeApiKey = useMutation(api.productApiKeys.revoke);

  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [mutationState, setMutationState] = useState<MutationState>({ kind: "idle" });
  const [createdKey, setCreatedKey] = useState<CreatedProductApiKey | null>(null);
  const [revokeCandidateId, setRevokeCandidateId] = useState<ProductApiKey["id"] | null>(
    null,
  );
  const [operationError, setOperationError] = useState<OperationError | null>(null);

  const nameError = validateApiKeyName(name);
  const isBusy = mutationState.kind !== "idle";

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameTouched(true);
    if (nameError) return;

    setMutationState({ kind: "creating" });
    setOperationError(null);
    try {
      const key = await createApiKey({ name: name.trim() });
      setCreatedKey(key);
      setName("");
      setNameTouched(false);
    } catch (cause) {
      setOperationError({
        kind: "create",
        message: errorMessage(cause, "Volt could not create the API key."),
      });
    } finally {
      setMutationState({ kind: "idle" });
    }
  }

  async function handleRevoke(id: ProductApiKey["id"]) {
    setMutationState({ kind: "revoking", id });
    setOperationError(null);
    try {
      await revokeApiKey({ id });
      setRevokeCandidateId(null);
    } catch (cause) {
      setOperationError({
        kind: "revoke",
        message: errorMessage(cause, "Volt could not revoke the API key."),
      });
    } finally {
      setMutationState({ kind: "idle" });
    }
  }

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950 text-white shadow-sm">
        <div className="relative px-5 py-6 sm:px-7 sm:py-8">
          <div className="pointer-events-none absolute -right-14 -top-16 size-56 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute -right-4 -top-5 size-32 rounded-full border border-white/10" />
          <div className="relative max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
              Product Data API
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Connect your tools to Volt product data.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Create a key for each service that needs product lookup by UPC, MPN, or title.
              Product responses include the stored specs and attributes. Revoke a key without
              affecting your other integrations.
            </p>
          </div>
        </div>
      </section>

      {createdKey ? (
        <NewApiKey key={createdKey.id} apiKey={createdKey} onDismiss={() => setCreatedKey(null)} />
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
            <KeyRound aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-zinc-950">Create an API key</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Use a label that tells you which tool or service owns this key.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleCreate}
          aria-busy={mutationState.kind === "creating"}
          className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start"
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="api-key-name" className="text-xs font-semibold text-zinc-700">
              Key label
            </label>
            <input
              id="api-key-name"
              name="name"
              type="text"
              autoComplete="off"
              maxLength={apiKeyNameMaxLength}
              value={name}
              onBlur={() => setNameTouched(true)}
              onChange={(event) => {
                setName(event.target.value);
                if (nameTouched) setNameTouched(false);
              }}
              aria-invalid={nameTouched && Boolean(nameError)}
              aria-describedby={nameTouched && nameError ? "api-key-name-error" : undefined}
              placeholder="Inventory sync"
              className="mt-1 h-11 w-full rounded-xl border border-zinc-300 px-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 aria-invalid:border-red-500 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-500/10"
            />
            {nameTouched && nameError ? (
              <p id="api-key-name-error" className="mt-1.5 text-xs font-medium text-red-700">
                {nameError}
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={isBusy}
            className="mt-1 flex h-11 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 sm:mt-6"
          >
            {mutationState.kind === "creating" ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <KeyRound aria-hidden="true" className="size-4" />
            )}
            {mutationState.kind === "creating" ? "Creating key" : "Create key"}
          </button>
        </form>

        {operationError?.kind === "create" ? (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
            {operationError.message}
          </p>
        ) : null}
      </section>

      <ApiKeyList
        apiKeys={apiKeys}
        mutationState={mutationState}
        error={operationError?.kind === "revoke" ? operationError.message : null}
        revokeCandidateId={revokeCandidateId}
        onRequestRevoke={setRevokeCandidateId}
        onCancelRevoke={() => setRevokeCandidateId(null)}
        onConfirmRevoke={(id) => void handleRevoke(id)}
      />

      <ApiExamples />
    </div>
  );
}

function NewApiKey({
  apiKey,
  onDismiss,
}: {
  apiKey: CreatedProductApiKey;
  onDismiss: () => void;
}) {
  const [copyState, setCopyState] = useState<CopyState>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function copyToken() {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard access is unavailable in this browser.");
      }
      await navigator.clipboard.writeText(apiKey.token);
      setCopyState({ kind: "copied" });
    } catch (cause) {
      setCopyState({
        kind: "error",
        message: errorMessage(cause, "Could not copy the key. Select it and copy it manually."),
      });
    }
  }

  return (
    <section
      aria-labelledby="new-api-key-heading"
      className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
          <ShieldCheck aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id="new-api-key-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold text-emerald-950 outline-none"
          >
            Save this key now
          </h2>
          <p className="mt-1 text-sm leading-6 text-emerald-900">
            This is the only time Volt will show the full key. You cannot view it again after
            closing this message.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="new-api-key-token" className="sr-only">
          New API key for {apiKey.name}
        </label>
        <input
          id="new-api-key-token"
          readOnly
          value={apiKey.token}
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-xl border border-emerald-300 bg-white px-3 font-mono text-xs text-zinc-950 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10"
        />
        <button
          type="button"
          onClick={() => void copyToken()}
          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-900 hover:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          {copyState.kind === "copied" ? (
            <Check aria-hidden="true" className="size-4" />
          ) : (
            <ClipboardCopy aria-hidden="true" className="size-4" />
          )}
          {copyState.kind === "copied" ? "Copied" : "Copy key"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="h-11 rounded-xl px-4 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          I saved it
        </button>
      </div>

      <p aria-live="polite" className="mt-2 min-h-5 text-xs font-medium text-emerald-900">
        {copyState.kind === "error" ? copyState.message : ""}
      </p>
    </section>
  );
}

function ApiKeyList({
  apiKeys,
  mutationState,
  error,
  revokeCandidateId,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: {
  apiKeys: ProductApiKey[] | undefined;
  mutationState: MutationState;
  error: string | null;
  revokeCandidateId: ProductApiKey["id"] | null;
  onRequestRevoke: (id: ProductApiKey["id"]) => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: (id: ProductApiKey["id"]) => void;
}) {
  return (
    <section aria-labelledby="api-keys-heading" className="space-y-3">
      <div>
        <h2 id="api-keys-heading" className="text-base font-semibold text-zinc-950">
          Your API keys
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Keys stay listed after revocation so you can audit old integrations.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {apiKeys === undefined ? (
        <div
          role="status"
          className="flex h-32 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white text-sm text-zinc-500"
        >
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Loading API keys
        </div>
      ) : apiKeys.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <KeyRound aria-hidden="true" className="mx-auto size-8 text-zinc-300" />
          <p className="mt-3 text-sm font-semibold text-zinc-950">No API keys yet</p>
          <p className="mt-1 text-sm text-zinc-500">Create your first key above.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {apiKeys.map((apiKey) => {
            const isRevoked = apiKey.revokedAt !== null;
            const isConfirming = revokeCandidateId === apiKey.id;
            const isRevoking =
              mutationState.kind === "revoking" && mutationState.id === apiKey.id;

            return (
              <li key={apiKey.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-zinc-950">{apiKey.name}</h3>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[0.68rem] font-semibold ${
                          isRevoked
                            ? "bg-zinc-100 text-zinc-600"
                            : "bg-emerald-50 text-emerald-800"
                        }`}
                      >
                        {isRevoked ? "Revoked" : "Active"}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-xs text-zinc-600">{apiKey.prefix}…</p>
                  </div>

                  {!isRevoked && !isConfirming ? (
                    <button
                      type="button"
                      onClick={() => onRequestRevoke(apiKey.id)}
                      disabled={mutationState.kind !== "idle"}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                      Revoke
                    </button>
                  ) : null}
                </div>

                <dl className="mt-4 grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-3">
                  <ApiKeyDate label="Created" value={apiKey.createdAt} />
                  <ApiKeyDate label="Last used" value={apiKey.lastUsedAt} />
                  <ApiKeyDate label="Revoked" value={apiKey.revokedAt} />
                </dl>

                {isConfirming ? (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-semibold text-red-950">Revoke {apiKey.name}?</p>
                    <p className="mt-1 text-xs leading-5 text-red-800">
                      Requests using this key will stop immediately. You cannot reactivate it.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        autoFocus
                        onClick={() => onConfirmRevoke(apiKey.id)}
                        disabled={isRevoking}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                      >
                        {isRevoking ? (
                          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                        ) : null}
                        {isRevoking ? "Revoking key" : "Confirm revoke"}
                      </button>
                      <button
                        type="button"
                        onClick={onCancelRevoke}
                        disabled={isRevoking}
                        className="h-9 rounded-lg px-3 text-xs font-semibold text-zinc-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-60"
                      >
                        Keep key
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ApiKeyDate({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </dt>
      <dd className="mt-1 text-xs font-medium text-zinc-700">
        {value === null ? (
          "Never"
        ) : (
          <time dateTime={new Date(value).toISOString()}>{dateTimeFormatter.format(value)}</time>
        )}
      </dd>
    </div>
  );
}

function ApiExamples() {
  const curlLineContinuation = "\\";
  const listExample = [
    `curl "${PRODUCT_DATA_API_ORIGIN}/v1/products?q=iPhone&limit=25" ${curlLineContinuation}`,
    '  -H "Authorization: Bearer YOUR_API_KEY"',
  ].join("\n");
  const lookupExample = [
    `curl "${PRODUCT_DATA_API_ORIGIN}/v1/products/012345678905" ${curlLineContinuation}`,
    '  -H "Authorization: Bearer YOUR_API_KEY"',
  ].join("\n");

  return (
    <section aria-labelledby="api-examples-heading" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700">
          <Terminal aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 id="api-examples-heading" className="text-base font-semibold text-zinc-950">
            Try the Product Data API
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Send the key as a Bearer token. Product search accepts optional q, limit, and cursor
            parameters. Each key can make 120 requests per minute.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <ApiExample label="Search products" command={listExample} />
        <ApiExample label="Look up a UPC" command={lookupExample} />
      </div>
    </section>
  );
}

function ApiExample({ label, command }: { label: string; command: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-zinc-700">{label}</p>
      <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs leading-6 text-zinc-200">
        <code>{command}</code>
      </pre>
    </div>
  );
}

function validateApiKeyName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Enter a label for this key.";
  if (trimmed.length > apiKeyNameMaxLength) {
    return `Use ${apiKeyNameMaxLength} characters or fewer.`;
  }
  if (controlCharacterPattern.test(trimmed)) {
    return "Remove line breaks or control characters from the label.";
  }
  return null;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
