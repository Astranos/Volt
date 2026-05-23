import type { VercelRequest, VercelResponse } from "@vercel/node";
import type {
  PrintRelayJob,
  PrintRelayJobStatus,
  PrintRelayPayloadType,
  PrintRelayPrinter,
  PrintRelayStation,
} from "../../../packages/scanner-protocol/src";

const RELAY_STATE_KEY = "volt:print-relay:state";
const STATION_ONLINE_WINDOW_MS = 45 * 1000;
const MAX_JOBS = 200;
const ID_PATTERN = /^[a-zA-Z0-9_-]{4,120}$/;

type RelayState = {
  stations: PrintRelayStation[];
  jobs: PrintRelayJob[];
};

const globalState = globalThis as typeof globalThis & {
  __voltPrintRelayState?: RelayState;
};

const memoryState = (globalState.__voltPrintRelayState ??= {
  stations: [],
  jobs: [],
});

const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const isVercelProduction = process.env.VERCEL === "1";

function hasRedisStorage() {
  return Boolean(redisUrl && redisToken);
}

function ensureRelayStorage() {
  if (isVercelProduction && !hasRedisStorage()) {
    throw new Error("Persistent print relay storage is not configured");
  }
}

async function redisCommand<T>(command: unknown[]) {
  if (!redisUrl || !redisToken) {
    throw new Error("Redis storage is not configured");
  }

  const result = await fetch(redisUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!result.ok) {
    throw new Error(`Redis command failed with ${result.status}`);
  }

  const payload = (await result.json()) as { result?: T; error?: string };
  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result;
}

function setCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizePayloadType(value: unknown): PrintRelayPayloadType {
  return value === "zpl" || value === "pdf" || value === "png" ? value : "text";
}

function normalizeStatus(value: unknown): PrintRelayJobStatus | null {
  if (
    value === "queued" ||
    value === "claimed" ||
    value === "printing" ||
    value === "printed" ||
    value === "failed"
  ) {
    return value;
  }
  return null;
}

function sanitizePrinters(value: unknown): PrintRelayPrinter[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((printer): PrintRelayPrinter | null => {
      const id = normalizeString(printer?.id);
      const name = normalizeString(printer?.name);
      if (!id || !name || !ID_PATTERN.test(id)) return null;

      const type = printer?.type;
      return {
        id,
        name,
        type: type === "brother" || type === "zebra" ? type : "other",
        localName: normalizeString(printer?.localName) || undefined,
      };
    })
    .filter((printer): printer is PrintRelayPrinter => Boolean(printer));
}

function withPresence(state: RelayState): RelayState {
  const onlineAfter = Date.now() - STATION_ONLINE_WINDOW_MS;
  return {
    ...state,
    stations: state.stations.map((station) => ({
      ...station,
      online: station.relayEnabled && Date.parse(station.lastSeenAt) >= onlineAfter,
    })),
  };
}

async function loadState(): Promise<RelayState> {
  if (hasRedisStorage()) {
    const rawState = await redisCommand<string | null>(["GET", RELAY_STATE_KEY]);
    if (!rawState) return { stations: [], jobs: [] };
    const parsed = JSON.parse(rawState) as Partial<RelayState>;
    return withPresence({
      stations: Array.isArray(parsed.stations) ? parsed.stations : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    });
  }

  return withPresence(memoryState);
}

async function saveState(state: RelayState) {
  const nextState = {
    stations: state.stations,
    jobs: state.jobs.slice(0, MAX_JOBS),
  };

  if (hasRedisStorage()) {
    await redisCommand<string>(["SET", RELAY_STATE_KEY, JSON.stringify(nextState)]);
    return;
  }

  memoryState.stations = nextState.stations;
  memoryState.jobs = nextState.jobs;
}

function pathPartsFromRequest(request: VercelRequest) {
  const path = request.query.path;
  const rawPath = typeof path === "string" ? path : request.url ?? "";
  return rawPath.split("?")[0].split("/").filter(Boolean);
}

function json(response: VercelResponse, status: number, payload: unknown) {
  response.status(status).json(payload);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  try {
    ensureRelayStorage();

    const pathParts = pathPartsFromRequest(request);
    const state = await loadState();

    if (request.method === "GET" && pathParts[0] === "stations") {
      json(response, 200, { stations: state.stations });
      return;
    }

    if (
      request.method === "POST" &&
      pathParts[0] === "stations" &&
      pathParts[1] === "register"
    ) {
      const stationId = normalizeString(request.body?.stationId);
      const name = normalizeString(request.body?.name, "Unnamed station");
      if (!stationId || !ID_PATTERN.test(stationId)) {
        json(response, 400, { error: "Invalid station ID" });
        return;
      }

      const station: PrintRelayStation = {
        id: stationId,
        name,
        location: normalizeString(request.body?.location) || undefined,
        relayEnabled: Boolean(request.body?.relayEnabled),
        online: Boolean(request.body?.relayEnabled),
        printers: sanitizePrinters(request.body?.printers),
        lastSeenAt: nowIso(),
      };

      const nextState = {
        ...state,
        stations: [
          station,
          ...state.stations.filter((item) => item.id !== station.id),
        ],
      };
      await saveState(nextState);
      json(response, 200, { station });
      return;
    }

    if (request.method === "POST" && pathParts[0] === "jobs" && !pathParts[1]) {
      const fromStationId = normalizeString(request.body?.fromStationId);
      const targetStationId = normalizeString(request.body?.targetStationId);
      const targetPrinterId = normalizeString(request.body?.targetPrinterId);
      const payload = normalizeString(request.body?.payload);

      if (
        !fromStationId ||
        !targetStationId ||
        !targetPrinterId ||
        !payload ||
        !ID_PATTERN.test(fromStationId) ||
        !ID_PATTERN.test(targetStationId) ||
        !ID_PATTERN.test(targetPrinterId)
      ) {
        json(response, 400, { error: "Invalid print job" });
        return;
      }

      const fromStation = state.stations.find((item) => item.id === fromStationId);
      const targetStation = state.stations.find((item) => item.id === targetStationId);
      const targetPrinter = targetStation?.printers.find(
        (printer) => printer.id === targetPrinterId
      );

      if (!targetStation || !targetPrinter) {
        json(response, 404, { error: "Target printer route not found" });
        return;
      }

      const timestamp = nowIso();
      const job: PrintRelayJob = {
        id: createId("job"),
        fromStationId,
        fromStationName: fromStation?.name ?? "Unknown station",
        targetStationId,
        targetPrinterId,
        targetPrinterName: targetPrinter.name,
        payloadType: normalizePayloadType(request.body?.payloadType),
        payload,
        label: normalizeString(request.body?.label, `Print to ${targetPrinter.name}`),
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await saveState({ ...state, jobs: [job, ...state.jobs] });
      json(response, 200, { job });
      return;
    }

    if (request.method === "GET" && pathParts[0] === "jobs") {
      const stationId = normalizeString(request.query.stationId);
      const includeSent = request.query.includeSent === "1";
      const jobs = state.jobs.filter((job) => {
        if (!stationId) return true;
        return (
          job.targetStationId === stationId ||
          (includeSent && job.fromStationId === stationId)
        );
      });
      json(response, 200, { jobs });
      return;
    }

    if (
      request.method === "POST" &&
      pathParts[0] === "jobs" &&
      pathParts[1] &&
      pathParts[2] === "claim"
    ) {
      const jobId = pathParts[1];
      const stationId = normalizeString(request.body?.stationId);
      const job = state.jobs.find((item) => item.id === jobId);

      if (!job) {
        json(response, 404, { error: "Job not found" });
        return;
      }
      if (job.targetStationId !== stationId) {
        json(response, 403, { error: "Station cannot claim this job" });
        return;
      }

      const timestamp = nowIso();
      const jobs = state.jobs.map((item) =>
        item.id === job.id
          ? {
              ...item,
              status: "claimed" as const,
              claimedAt: item.claimedAt ?? timestamp,
              updatedAt: timestamp,
            }
          : item
      );
      await saveState({ ...state, jobs });
      json(response, 200, { job: jobs.find((item) => item.id === job.id) });
      return;
    }

    if (
      request.method === "POST" &&
      pathParts[0] === "jobs" &&
      pathParts[1] &&
      pathParts[2] === "status"
    ) {
      const jobId = pathParts[1];
      const stationId = normalizeString(request.body?.stationId);
      const status = normalizeStatus(request.body?.status);
      const job = state.jobs.find((item) => item.id === jobId);

      if (!job || !status) {
        json(response, 404, { error: "Job not found" });
        return;
      }
      if (job.targetStationId !== stationId && job.fromStationId !== stationId) {
        json(response, 403, { error: "Station cannot update this job" });
        return;
      }

      const timestamp = nowIso();
      const jobs = state.jobs.map((item) =>
        item.id === job.id
          ? {
              ...item,
              status,
              error: status === "failed" ? normalizeString(request.body?.error, "Print failed") : undefined,
              updatedAt: timestamp,
              completedAt:
                status === "printed" || status === "failed"
                  ? timestamp
                  : item.completedAt,
            }
          : item
      );
      await saveState({ ...state, jobs });
      json(response, 200, { job: jobs.find((item) => item.id === job.id) });
      return;
    }

    json(response, 404, { error: "Not found" });
  } catch (error) {
    console.error("Print relay storage error", error);
    json(response, 500, { error: "Print relay unavailable" });
  }
}
