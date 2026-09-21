import { CheckCircle2, Loader2, Radio, ScanBarcode, Smartphone, Trash2 } from "lucide-react";
import { PairingDialog, PhotosPanel, ResultsPanel, StatusText } from "./-scanner-demo-ui";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { DEFAULT_SESSION_LABEL, statusLabel } from "./-scanner-demo-model";
import type { useScannerDemoRuntime } from "./-scanner-demo-runtime";

export function ScannerDemoView({ captures, photos, reviewInputRef, reviewInputValue, handleReviewInputChange, pairingDialogOpen, copyPairingUrl, qrDataUrl, status, setPairingDialogOpen, iceLabel, receivedCount, joinWindow, sessionLabel, setSessionLabel, startPairing, reset, error }: ReturnType<typeof useScannerDemoRuntime>) {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <SiteHeader variant="scanner" />

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="space-y-5">
          <div className="min-w-0 rounded-[1.35rem] border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(28rem,1fr)] lg:items-start">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
                  Scan to this browser.
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600">
                  No Chrome extension needed. Pair Volt on iPhone with this tab,
                  then copy text results or download photo batches before
                  closing the session.
                </p>
                <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-zinc-500">
                  <StatusText
                    icon={Smartphone}
                    label="Session"
                    value={statusLabel(status)}
                  />
                  <StatusText
                    icon={Radio}
                    label="Connection"
                    value={iceLabel}
                  />
                  <StatusText
                    icon={CheckCircle2}
                    label="Received"
                    value={String(receivedCount)}
                  />
                  {joinWindow?.expiresAt ? (
                    <span className="min-w-0 truncate">
                      Expires{" "}
                      {new Date(joinWindow.expiresAt).toLocaleTimeString()}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="min-w-0">
                <label
                  htmlFor="private-session-label"
                  className="text-sm font-semibold text-zinc-800"
                >
                  Session name
                </label>
                <input
                  id="private-session-label"
                  type="text"
                  value={sessionLabel}
                  maxLength={64}
                  onChange={(event) => setSessionLabel(event.target.value)}
                  placeholder={DEFAULT_SESSION_LABEL}
                  className="mt-2 h-11 w-full rounded-[0.85rem] border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                />

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void startPairing()}
                    disabled={status === "creating" || status === "connecting"}
                    className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-[0.85rem] bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === "creating" || status === "connecting" ? (
                      <Loader2 size={17} className="animate-spin" />
                    ) : (
                      <ScanBarcode size={17} />
                    )}
                    <span className="truncate">
                      {joinWindow ? "New session" : "Create session"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-[0.85rem] border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:border-zinc-950"
                  >
                    <Trash2 size={17} />
                    <span className="truncate">Reset</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPairingDialogOpen(true)}
                    disabled={!joinWindow?.qrCodeUrl}
                    className="col-span-2 inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-[0.85rem] border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1"
                  >
                    <ScanBarcode size={17} />
                    <span className="truncate">Show QR</span>
                  </button>
                </div>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-[0.95rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            ) : null}

          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(20rem,0.78fr)_minmax(0,1.22fr)] lg:items-start">
            <div className="min-w-0">
              <ResultsPanel
                captures={captures}
                reviewInputRef={reviewInputRef}
                reviewInputValue={reviewInputValue}
                onReviewInputChange={handleReviewInputChange}
              />
            </div>

            <div className="min-w-0">
              <PhotosPanel photos={photos} />
            </div>
          </div>
        </div>
      </section>
      {pairingDialogOpen ? (
        <PairingDialog
          copyPairingUrl={copyPairingUrl}
          qrDataUrl={qrDataUrl}
          status={status}
          statusLabel={statusLabel}
          onClose={() => setPairingDialogOpen(false)}
        />
      ) : null}
      <SiteFooter />
    </main>
  );
}
