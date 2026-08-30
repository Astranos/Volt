import { cronJobs, makeFunctionReference } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();
const cleanupUsageSessions = makeFunctionReference<"mutation", Record<string, never>, { ended: number }>(
  "access:cleanupUsageSessions",
);
const cleanupProductApiRateLimitWindows = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { deleted: number }
>("productApiKeys:cleanupRateLimitWindows");

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

crons.interval(
  "cleanup product API rate limit windows",
  { minutes: 5 },
  cleanupProductApiRateLimitWindows,
  {},
);

export default crons;
