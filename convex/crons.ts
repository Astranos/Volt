import { cronJobs, makeFunctionReference } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();
const cleanupUsageSessions = makeFunctionReference<"mutation", Record<string, never>, { ended: number }>(
  "access:cleanupUsageSessions",
);

crons.interval(
  "cleanup expired scanner signaling state",
  { minutes: 5 },
  internal.scannerSignal.cleanup.cleanupExpired,
  {},
);

crons.interval(
  "end expired scanner usage sessions",
  { minutes: 5 },
  cleanupUsageSessions,
  {},
);

crons.interval(
  "sweep expired workspace presence",
  { seconds: 60 },
  internal.cloudWorkspace.sweepExpiredPresence,
  {},
);

crons.interval(
  "sweep expired cursor deliveries",
  { seconds: 60 },
  internal.cloudWorkspace.sweepExpiredCursorDeliveries,
  {},
);

export default crons;
