import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Laptop,
  Loader2,
  Network,
  Plus,
  Printer,
  RefreshCw,
  Route,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  PRINT_RELAY_URL,
  type PrintRelayJob,
  type PrintRelayJobStatus,
  type PrintRelayPrinter,
  type PrintRelayPrinterType,
  type PrintRelayStation,
} from "../../../../scanner-protocol/src";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { cn } from "../../lib/utils";

const CONFIG_KEY = "volt.printRelay.localConfig";
const POLL_INTERVAL_MS = 5000;

type LocalConfig = {
  stationId: string;
  stationName: string;
  location: string;
  relayEnabled: boolean;
  printers: PrintRelayPrinter[];
};

const defaultConfig: LocalConfig = {
  stationId: "",
  stationName: "Front Counter Browser",
  location: "",
  relayEnabled: false,
  printers: [
    {
      id: "printer-brother-front",
      name: "Brother QL Front",
      type: "brother",
    },
    {
      id: "printer-zebra-receiving",
      name: "Zebra Receiving",
      type: "zebra",
    },
  ],
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch (_err) {
    return "";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${PRINT_RELAY_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = typeof payload?.error === "string" ? `: ${payload.error}` : "";
    } catch (_err) {}
    throw new Error(`Print relay request failed (${response.status})${detail}`);
  }

  return response.json() as Promise<T>;
}

function statusVariant(status: PrintRelayJobStatus) {
  return status === "printed"
    ? "default"
    : status === "failed"
      ? "destructive"
      : "secondary";
}

function printerTypeFromName(name: string): PrintRelayPrinterType {
  const lowered = name.toLowerCase();
  if (lowered.includes("zebra")) return "zebra";
  if (lowered.includes("brother")) return "brother";
  return "other";
}

interface PrintRelayProps {
  onClose?: () => void;
}

export default function PrintRelay({ onClose: _onClose }: PrintRelayProps) {
  const [config, setConfig] = useState<LocalConfig>(defaultConfig);
  const [stations, setStations] = useState<PrintRelayStation[]>([]);
  const [jobs, setJobs] = useState<PrintRelayJob[]>([]);
  const [printerName, setPrinterName] = useState("");
  const [printerType, setPrinterType] = useState<PrintRelayPrinterType>("zebra");
  const [selectedStationId, setSelectedStationId] = useState("");
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistConfig = useCallback((nextConfig: LocalConfig) => {
    setConfig(nextConfig);
    void chrome.storage.local.set({ [CONFIG_KEY]: nextConfig });
  }, []);

  const registerStation = useCallback(async (nextConfig: LocalConfig) => {
    const { station } = await requestJson<{ station: PrintRelayStation }>(
      "/stations/register",
      {
        method: "POST",
        body: JSON.stringify({
          stationId: nextConfig.stationId,
          name: nextConfig.stationName,
          location: nextConfig.location,
          relayEnabled: nextConfig.relayEnabled,
          printers: nextConfig.printers,
        }),
      }
    );
    return station;
  }, []);

  const refreshRelay = useCallback(
    async (nextConfig: LocalConfig) => {
      if (!nextConfig.stationId) return;

      try {
        setError(null);
        await registerStation(nextConfig);
        const [stationPayload, jobPayload] = await Promise.all([
          requestJson<{ stations: PrintRelayStation[] }>("/stations"),
          requestJson<{ jobs: PrintRelayJob[] }>(
            `/jobs?stationId=${encodeURIComponent(nextConfig.stationId)}&includeSent=1`
          ),
        ]);
        setStations(stationPayload.stations);
        setJobs(jobPayload.jobs);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Print relay unavailable");
      } finally {
        setLoading(false);
      }
    },
    [registerStation]
  );

  useEffect(() => {
    chrome.storage.local.get(CONFIG_KEY).then((stored) => {
      const saved = stored[CONFIG_KEY] as LocalConfig | undefined;
      const nextConfig = {
        ...defaultConfig,
        ...saved,
        stationId: saved?.stationId || createId("station"),
        printers: Array.isArray(saved?.printers)
          ? saved.printers
          : defaultConfig.printers,
      };
      setConfig(nextConfig);
      void chrome.storage.local.set({ [CONFIG_KEY]: nextConfig });
      void refreshRelay(nextConfig);
    });
  }, [refreshRelay]);

  useEffect(() => {
    if (!config.stationId) return;
    const interval = window.setInterval(() => {
      void refreshRelay(config);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [config, refreshRelay]);

  const remotePrinterRoutes = useMemo(() => {
    return stations.flatMap((station) =>
      station.printers.map((printer) => ({
        station,
        printer,
      }))
    );
  }, [stations]);

  useEffect(() => {
    const firstRoute = remotePrinterRoutes[0];
    if (!selectedStationId && firstRoute) {
      setSelectedStationId(firstRoute.station.id);
      setSelectedPrinterId(firstRoute.printer.id);
    }
  }, [remotePrinterRoutes, selectedPrinterId, selectedStationId]);

  const selectedStation = stations.find((station) => station.id === selectedStationId);
  const selectedPrinter = selectedStation?.printers.find(
    (printer) => printer.id === selectedPrinterId
  );

  const inboundJobs = jobs.filter((job) => job.targetStationId === config.stationId);
  const sentJobs = jobs.filter((job) => job.fromStationId === config.stationId);

  const updateConfig = (patch: Partial<LocalConfig>) => {
    const nextConfig = { ...config, ...patch };
    persistConfig(nextConfig);
    void refreshRelay(nextConfig);
  };

  const addPrinter = () => {
    const name = printerName.trim();
    if (!name) return;

    const nextConfig = {
      ...config,
      printers: [
        ...config.printers,
        {
          id: createId("printer"),
          name,
          type: printerType,
        },
      ],
    };
    setPrinterName("");
    persistConfig(nextConfig);
    void refreshRelay(nextConfig);
  };

  const removePrinter = (printerId: string) => {
    const nextConfig = {
      ...config,
      printers: config.printers.filter((printer) => printer.id !== printerId),
    };
    persistConfig(nextConfig);
    void refreshRelay(nextConfig);
  };

  const queueTestJob = async () => {
    if (!selectedStation || !selectedPrinter) return;

    setSaving(true);
    try {
      setError(null);
      await requestJson<{ job: PrintRelayJob }>("/jobs", {
        method: "POST",
        body: JSON.stringify({
          fromStationId: config.stationId,
          targetStationId: selectedStation.id,
          targetPrinterId: selectedPrinter.id,
          payloadType: selectedPrinter.type === "zebra" ? "zpl" : "text",
          payload:
            selectedPrinter.type === "zebra"
              ? "^XA^FO50,50^ADN,36,20^FDVolt test label^FS^XZ"
              : "Volt test label",
          label: `Test label to ${selectedPrinter.name}`,
        }),
      });
      await refreshRelay(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue print job");
    } finally {
      setSaving(false);
    }
  };

  const claimJob = async (job: PrintRelayJob) => {
    setSaving(true);
    try {
      await requestJson<{ job: PrintRelayJob }>(`/jobs/${job.id}/claim`, {
        method: "POST",
        body: JSON.stringify({ stationId: config.stationId }),
      });
      await refreshRelay(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim job");
    } finally {
      setSaving(false);
    }
  };

  const updateJobStatus = async (job: PrintRelayJob, status: PrintRelayJobStatus) => {
    setSaving(true);
    try {
      await requestJson<{ job: PrintRelayJob }>(`/jobs/${job.id}/status`, {
        method: "POST",
        body: JSON.stringify({
          stationId: config.stationId,
          status,
          error: status === "failed" ? "Marked failed in extension" : undefined,
        }),
      });
      await refreshRelay(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Printer className="h-4 w-4 text-emerald-700" />
              <h2 className="truncate text-base font-semibold text-slate-950">
                Network Print Relay
              </h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Register this browser, route jobs, and poll jobs assigned to this
              station.
            </p>
          </div>
          <Badge
            variant={config.relayEnabled ? "default" : "secondary"}
            className="shrink-0"
          >
            {config.relayEnabled ? "Online" : "Paused"}
          </Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4">
        {error ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <p className="text-xs leading-5 text-amber-900">{error}</p>
            </div>
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label className="text-sm font-semibold text-slate-900">
                This browser can receive jobs
              </Label>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Turn this on when this computer can reach its local label printers.
              </p>
            </div>
            <Switch
              checked={config.relayEnabled}
              onCheckedChange={(relayEnabled) => updateConfig({ relayEnabled })}
            />
          </div>
          <div className="mt-3 grid gap-2">
            <div>
              <Label htmlFor="station-name" className="text-xs text-slate-600">
                Station name
              </Label>
              <Input
                id="station-name"
                className="mt-1"
                value={config.stationName}
                onChange={(event) => updateConfig({ stationName: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="station-location" className="text-xs text-slate-600">
                Location
              </Label>
              <Input
                id="station-location"
                className="mt-1"
                placeholder="Register, back room, office"
                value={config.location}
                onChange={(event) => updateConfig({ location: event.target.value })}
              />
            </div>
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">This Station Printers</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2"
              onClick={() => void refreshRelay(config)}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync
            </Button>
          </div>

          <div className="space-y-2">
            {config.printers.map((printer) => (
              <div
                key={printer.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-950">
                    {printer.name}
                  </p>
                  <p className="text-xs capitalize text-slate-500">{printer.type}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => removePrinter(printer.id)}
                  aria-label={`Remove ${printer.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="grid gap-2">
              <Input
                placeholder="Printer name"
                value={printerName}
                onChange={(event) => {
                  const name = event.target.value;
                  setPrinterName(name);
                  setPrinterType(printerTypeFromName(name));
                }}
              />
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={printerType}
                onChange={(event) =>
                  setPrinterType(event.target.value as PrintRelayPrinterType)
                }
              >
                <option value="zebra">Zebra</option>
                <option value="brother">Brother</option>
                <option value="other">Other</option>
              </select>
              <Button className="w-full gap-2" onClick={addPrinter}>
                <Plus className="h-4 w-4" />
                Add local printer
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Available Routes</h3>
            <Badge variant="outline" className="gap-1">
              <Network className="h-3 w-3" />
              {stations.filter((station) => station.online).length} online
            </Badge>
          </div>

          <div className="space-y-2">
            {remotePrinterRoutes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                No relay stations have registered yet.
              </div>
            ) : (
              remotePrinterRoutes.map(({ station, printer }) => {
                const selected =
                  selectedStationId === station.id && selectedPrinterId === printer.id;
                return (
                  <button
                    key={`${station.id}:${printer.id}`}
                    type="button"
                    onClick={() => {
                      setSelectedStationId(station.id);
                      setSelectedPrinterId(printer.id);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left",
                      selected
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Laptop className="h-4 w-4 shrink-0 text-slate-500" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-950">
                          {printer.name}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {station.name}
                          {station.location ? `, ${station.location}` : ""}
                        </span>
                      </span>
                    </span>
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        station.online ? "bg-emerald-500" : "bg-slate-300"
                      )}
                    />
                  </button>
                );
              })
            )}
          </div>

          <Button
            className="mt-3 w-full gap-2"
            onClick={queueTestJob}
            disabled={!selectedStation || !selectedPrinter || saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Queue test label
          </Button>
        </section>

        <section className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Incoming Jobs</h3>
          {inboundJobs.length === 0 ? (
            <EmptyQueue>No jobs assigned to this browser.</EmptyQueue>
          ) : (
            <div className="space-y-2">
              {inboundJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  footer={
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => claimJob(job)}
                        disabled={job.status !== "queued" || saving}
                      >
                        Claim
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateJobStatus(job, "printed")}
                        disabled={job.status === "printed" || saving}
                      >
                        Printed
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateJobStatus(job, "failed")}
                        disabled={job.status === "failed" || saving}
                      >
                        Fail
                      </Button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Sent Jobs</h3>
          {sentJobs.length === 0 ? (
            <EmptyQueue>No jobs sent from this browser.</EmptyQueue>
          ) : (
            <div className="space-y-2">
              {sentJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <p className="text-xs leading-5 text-amber-900">
              This now relays jobs through the server and receiving browser. Actual
              silent printing still needs a native messaging print helper on the
              receiving computer.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function EmptyQueue({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function JobCard({
  job,
  footer,
}: {
  job: PrintRelayJob;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {job.status === "printed" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : job.status === "failed" ? (
              <XCircle className="h-4 w-4 text-red-600" />
            ) : (
              <Clock3 className="h-4 w-4 text-slate-500" />
            )}
            <p className="truncate text-sm font-semibold text-slate-950">
              {job.label}
            </p>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {job.targetPrinterName} from {job.fromStationName} at{" "}
            {formatTime(job.createdAt)}
          </p>
          {job.error ? (
            <p className="mt-1 text-xs text-red-700">{job.error}</p>
          ) : null}
        </div>
        <Badge variant={statusVariant(job.status)} className="shrink-0 gap-1">
          <Route className="h-3 w-3" />
          {job.status}
        </Badge>
      </div>
      {footer}
    </div>
  );
}
